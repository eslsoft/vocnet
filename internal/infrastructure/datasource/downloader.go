package datasource

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	downloadTimeout       = 10 * time.Minute
	maxUncompressedSize   = 1000 << 20 // 1GB safety limit
	progressUpdateBytes   = 10 << 20   // Update progress every 10MB
)

// downloadWithProgress downloads a file from URL with progress reporting
func downloadWithProgress(ctx context.Context, url, destPath string, logger *slog.Logger) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: %s", resp.Status)
	}

	// Create temp file in same directory as destination
	tmpFile, err := os.CreateTemp(filepath.Dir(destPath), ".download-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpName := tmpFile.Name()
	defer func() { _ = os.Remove(tmpName) }()

	// Download with progress reporting
	totalSize := resp.ContentLength
	var downloaded int64
	lastProgress := int64(0)

	logger.Info("downloading", "url", url, "size_mb", totalSize/(1024*1024))

	reader := io.TeeReader(resp.Body, &progressWriter{
		written: &downloaded,
		total:   totalSize,
		logger:  logger,
		lastLog: &lastProgress,
	})

	if _, err := io.Copy(tmpFile, reader); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("download: %w", err)
	}

	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("sync: %w", err)
	}

	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tmpName, destPath); err != nil {
		return fmt.Errorf("rename: %w", err)
	}

	logger.Info("download completed", "path", destPath)
	return nil
}

// progressWriter wraps a writer to report download progress
type progressWriter struct {
	written *int64
	total   int64
	logger  *slog.Logger
	lastLog *int64
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n := len(p)
	*pw.written += int64(n)

	// Log progress every 10MB
	if *pw.written-*pw.lastLog >= progressUpdateBytes {
		percent := float64(*pw.written) / float64(pw.total) * 100
		pw.logger.Info("download progress",
			"downloaded_mb", *pw.written/(1024*1024),
			"total_mb", pw.total/(1024*1024),
			"percent", fmt.Sprintf("%.1f%%", percent))
		*pw.lastLog = *pw.written
	}

	return n, nil
}

// prepareCachePath determines cache file path and checks if cached version exists
func prepareCachePath(url, cacheDir, filename string) (cachePath string, fromCache bool, err error) {
	if cacheDir == "" {
		userCache, err := os.UserCacheDir()
		if err != nil {
			return "", false, fmt.Errorf("get user cache dir: %w", err)
		}
		cacheDir = filepath.Join(userCache, "vocnet")
	}

	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return "", false, fmt.Errorf("create cache dir: %w", err)
	}

	// Use CRC32 hash of URL if no filename provided
	if filename == "" {
		h := crc32.ChecksumIEEE([]byte(url))
		filename = fmt.Sprintf("download-%08x%s", h, filepath.Ext(url))
	}

	cachePath = filepath.Join(cacheDir, filename)

	// Check if cache exists and is valid
	if st, err := os.Stat(cachePath); err == nil && st.Size() > 0 {
		return cachePath, true, nil
	}

	return cachePath, false, nil
}

// extractTarGz extracts a .tar.gz file to destination directory
func extractTarGz(archivePath, destDir string, logger *slog.Logger) error {
	logger.Info("extracting archive", "path", archivePath, "dest", destDir)

	f, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("open archive: %w", err)
	}
	defer func() { _ = f.Close() }()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("create gzip reader: %w", err)
	}
	defer func() { _ = gzr.Close() }()

	tr := tar.NewReader(gzr)

	for {
		header, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read tar header: %w", err)
		}

		// Sanitize path
		target := filepath.Join(destDir, filepath.Clean(header.Name))
		if !strings.HasPrefix(target, filepath.Clean(destDir)+string(os.PathSeparator)) {
			return fmt.Errorf("illegal file path: %s", header.Name)
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return fmt.Errorf("create directory %s: %w", target, err)
			}

		case tar.TypeReg:
			// Create parent directory
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return fmt.Errorf("create parent dir: %w", err)
			}

			outFile, err := os.Create(target)
			if err != nil {
				return fmt.Errorf("create file %s: %w", target, err)
			}

			if _, err := io.Copy(outFile, tr); err != nil {
				_ = outFile.Close()
				return fmt.Errorf("extract file %s: %w", target, err)
			}

			_ = outFile.Close()
		}
	}

	logger.Info("extraction completed", "dest", destDir)
	return nil
}

// extractZipSingle extracts a single file matching the predicate from a zip archive
func extractZipSingle(archivePath, destDir string, match func(string) bool, logger *slog.Logger) (string, error) {
	logger.Info("extracting from zip", "path", archivePath)

	zr, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", fmt.Errorf("open zip: %w", err)
	}
	defer func() { _ = zr.Close() }()

	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}

		if match(f.Name) {
			if f.UncompressedSize64 > maxUncompressedSize {
				return "", fmt.Errorf("uncompressed size %d exceeds safety limit", f.UncompressedSize64)
			}

			rc, err := f.Open()
			if err != nil {
				return "", fmt.Errorf("open zip entry: %w", err)
			}
			defer func() { _ = rc.Close() }()

			outPath := filepath.Join(destDir, filepath.Base(f.Name))

			// Create parent directory
			if err := os.MkdirAll(filepath.Dir(outPath), 0755); err != nil {
				return "", fmt.Errorf("create parent dir: %w", err)
			}

			out, err := os.Create(outPath)
			if err != nil {
				return "", fmt.Errorf("create output file: %w", err)
			}

			size, err := safeUint64ToInt64(f.UncompressedSize64)
			if err != nil {
				_ = out.Close()
				return "", err
			}

			written, err := io.CopyN(out, rc, size)
			if err != nil && !errors.Is(err, io.EOF) {
				_ = out.Close()
				return "", fmt.Errorf("copy data: %w", err)
			}

			if written != size {
				_ = out.Close()
				return "", fmt.Errorf("unexpected truncated copy: wrote %d bytes of %d", written, f.UncompressedSize64)
			}

			_ = out.Close()

			logger.Info("extracted file", "path", outPath)
			return outPath, nil
		}
	}

	return "", errors.New("no matching file found in archive")
}

// extractGz extracts a .gz file to destination
func extractGz(archivePath, destPath string, logger *slog.Logger) error {
	logger.Info("extracting gzip", "archive", archivePath, "dest", destPath)

	f, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("open archive: %w", err)
	}
	defer func() { _ = f.Close() }()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("create gzip reader: %w", err)
	}
	defer func() { _ = gzr.Close() }()

	// Create parent directory
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return fmt.Errorf("create parent dir: %w", err)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("create output file: %w", err)
	}
	defer func() { _ = out.Close() }()

	if _, err := io.Copy(out, gzr); err != nil {
		return fmt.Errorf("extract: %w", err)
	}

	logger.Info("extraction completed", "path", destPath)
	return nil
}

// safeUint64ToInt64 safely converts uint64 to int64
func safeUint64ToInt64(v uint64) (int64, error) {
	if v > math.MaxInt64 {
		return 0, fmt.Errorf("value %d exceeds int64 capacity", v)
	}
	return int64(v), nil
}
