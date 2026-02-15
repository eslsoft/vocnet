package datasource

import (
	"context"
	"fmt"
	"hash/crc32"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const (
	downloadTimeout     = 10 * time.Minute
	progressUpdateBytes = 10 << 20 // Update progress every 10MB
)

// Downloader encapsulates shared download/cache behavior for all data sources.
type Downloader struct {
	cacheDir string
	logger   *slog.Logger
	timeout  time.Duration
}

// DownloadRequest describes a source download request.
type DownloadRequest struct {
	Source string
	URL    string
}

func NewDownloader(cacheDir string, logger *slog.Logger) *Downloader {
	return &Downloader{
		cacheDir: cacheDir,
		logger:   logger,
		timeout:  downloadTimeout,
	}
}

// Fetch returns a local artifact path for the requested source URL.
// Storage details (including cache) are internal to Downloader.
func (d *Downloader) Fetch(ctx context.Context, req DownloadRequest) (string, error) {
	artifactPath, fromCache, err := prepareCachePath(req.URL, d.cacheDir, "")
	if err != nil {
		return "", fmt.Errorf("prepare artifact: %w", err)
	}

	if fromCache {
		d.logger.Debug("using local artifact", "source", req.Source, "path", artifactPath)
		return artifactPath, nil
	}

	d.logger.Info("downloading data source", "source", req.Source, "url", req.URL)
	downloadCtx, cancel := context.WithTimeout(ctx, d.timeout)
	defer cancel()

	if err := downloadWithProgress(downloadCtx, req.URL, artifactPath, d.logger); err != nil {
		return "", fmt.Errorf("download: %w", err)
	}

	return artifactPath, nil
}

// DownloadFile ensures the source URL is available locally and atomically writes it to dst.
func (d *Downloader) DownloadFile(ctx context.Context, req DownloadRequest, dst, tempPrefix string) error {
	artifactPath, err := d.Fetch(ctx, req)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return fmt.Errorf("create destination directory: %w", err)
	}
	return copyFileAtomic(artifactPath, dst, tempPrefix)
}

// copyFileAtomic copies src to dst via a temp file in dst directory and atomic rename.
func copyFileAtomic(src, dst, tempPrefix string) error {
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer func() { _ = in.Close() }()

	tmp, err := os.CreateTemp(filepath.Dir(dst), tempPrefix)
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()

	if _, err := io.Copy(tmp, in); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("copy data: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("sync temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}

	if err := os.Rename(tmpName, dst); err != nil {
		return fmt.Errorf("rename temp file: %w", err)
	}

	return nil
}

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
		pw.logger.Debug("download progress",
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
