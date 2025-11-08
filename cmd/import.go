/*
Copyright © 2025 Ambor <saltbo@foxmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
package cmd

import (
	"compress/gzip"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/infrastructure/database"
	"github.com/eslsoft/vocnet/internal/usecase/backup"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

const (
	importInputKey   = "backup.import.input"
	importGzipKey    = "backup.import.gzip"
	importTablesKey  = "backup.import.tables"
	importBatchKey   = "backup.import.batch_size"
	importTxBatchKey = "backup.import.tx_batch_count"
)

var importCmd = &cobra.Command{
	Use:   "import",
	Short: "从备份文件导入数据库内容",
	RunE: func(cmd *cobra.Command, args []string) (err error) {
		ctx := cmd.Context()

		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("加载配置失败: %w", err)
		}

		entClient, cleanup, err := database.NewEntClient(cfg)
		if err != nil {
			return fmt.Errorf("创建 ent 客户端失败: %w", err)
		}
		if err := entClient.Schema.Create(ctx); err != nil {
			cleanup()
			return fmt.Errorf("执行数据库迁移失败: %w", err)
		}
		cleanup()

		inputPath := viper.GetString(importInputKey)
		gzipEnabled := viper.GetBool(importGzipKey)
		tableList := tablesFromConfig(importTablesKey)
		batchSize := viper.GetInt(importBatchKey)
		txBatchCount := viper.GetInt(importTxBatchKey)

		if inputPath == "" {
			return fmt.Errorf("请通过 --input 指定备份文件或使用 - 表示标准输入")
		}
		if !gzipEnabled && inputPath != "-" && strings.HasSuffix(strings.ToLower(inputPath), ".gz") {
			gzipEnabled = true
		}

		driver, err := cfg.DatabaseDriver()
		if err != nil {
			return fmt.Errorf("解析数据库驱动失败: %w", err)
		}
		dsn, err := cfg.DatabaseURL()
		if err != nil {
			return fmt.Errorf("解析数据库 DSN 失败: %w", err)
		}

		service, err := backup.NewService(
			driver,
			dsn,
			backup.WithBatchSize(batchSize),
			backup.WithTxBatchCount(txBatchCount),
		)
		if err != nil {
			return fmt.Errorf("创建备份服务失败: %w", err)
		}

		var (
			reader  = cmd.InOrStdin()
			closers []func() error
		)

		if inputPath != "-" {
			file, openErr := os.Open(filepath.Clean(inputPath))
			if openErr != nil {
				return fmt.Errorf("打开备份文件失败: %w", openErr)
			}
			reader = file
			closers = append(closers, file.Close)
		}

		if gzipEnabled {
			gzr, gzErr := gzip.NewReader(reader)
			if gzErr != nil {
				return fmt.Errorf("创建 gzip 读取器失败: %w", gzErr)
			}
			reader = gzr
			closers = append([]func() error{gzr.Close}, closers...)
		}

		defer func() {
			for _, closer := range closers {
				if cerr := closer(); cerr != nil && err == nil {
					err = cerr
				}
			}
		}()

		var importOpts []backup.ImportOption
		if len(tableList) > 0 {
			importOpts = append(importOpts, backup.WithImportTables(tableList))
		}

		progress := newBackupProgress(cmd.OutOrStdout(), "导入")
		importOpts = append(importOpts, backup.WithImportProgressReporter(progress))

		if err := service.Import(ctx, reader, importOpts...); err != nil {
			return fmt.Errorf("导入备份失败: %w", err)
		}

		if inputPath == "-" {
			cmd.Println("导入完成: 数据来源于标准输入")
		} else {
			cmd.Printf("导入完成: %s\n", inputPath)
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(importCmd)

	importCmd.Flags().StringP("input", "i", "", "备份文件路径，使用 - 表示标准输入")
	importCmd.Flags().Bool("gzip", false, "输入为 gzip 压缩格式")
	importCmd.Flags().StringSlice("tables", nil, "仅导入指定表，逗号分隔或重复指定")
	importCmd.Flags().Int("batch-size", 0, "导入批处理大小 (默认 512)")
	importCmd.Flags().Int("tx-batch-count", 0, "每个事务处理的记录数 (默认 100，设置更大可提高性能但占用更多内存)")

	bindImportConfig()
}

func bindImportConfig() {
	bindFlagToViper(importInputKey, importCmd.Flags().Lookup("input"))
	bindFlagToViper(importGzipKey, importCmd.Flags().Lookup("gzip"))
	bindFlagToViper(importTablesKey, importCmd.Flags().Lookup("tables"))
	bindFlagToViper(importBatchKey, importCmd.Flags().Lookup("batch-size"))
	bindFlagToViper(importTxBatchKey, importCmd.Flags().Lookup("tx-batch-count"))
}
