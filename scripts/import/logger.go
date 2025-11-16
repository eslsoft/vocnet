package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"
)

var (
	// infoLog logs all information to file
	infoLog *log.Logger
	// warnLog logs warnings to both file and stderr
	warnLog *log.Logger
	// errorLog logs errors to both file and stderr
	errorLog *log.Logger
)

// setupLogging configures logging to output to both file and stderr
func setupLogging() (*os.File, error) {
	// Create logs directory
	logDir := "logs"
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return nil, fmt.Errorf("create log directory: %w", err)
	}

	// Create log file with timestamp
	timestamp := time.Now().Format("2006-01-02_15-04-05")
	logFile := filepath.Join(logDir, fmt.Sprintf("import_%s.log", timestamp))
	file, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}

	// Setup different log levels
	// Info: only to file
	infoLog = log.New(file, "", log.LstdFlags|log.Lmicroseconds)

	// Warning: to both file and stderr
	warnLog = log.New(io.MultiWriter(file, os.Stderr), "[WARN] ", log.LstdFlags)

	// Error: to both file and stderr
	errorLog = log.New(io.MultiWriter(file, os.Stderr), "[ERROR] ", log.LstdFlags)

	// Replace default log with infoLog
	log.SetOutput(file)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	return file, nil
}

// Info logs informational messages (file only)
func Info(format string, v ...interface{}) {
	if infoLog != nil {
		infoLog.Printf(format, v...)
	}
}

// Warn logs warning messages (file + stderr)
func Warn(format string, v ...interface{}) {
	if warnLog != nil {
		warnLog.Printf(format, v...)
	}
}

// Error logs error messages (file + stderr)
func Error(format string, v ...interface{}) {
	if errorLog != nil {
		errorLog.Printf(format, v...)
	}
}

// Printf is a convenience function that logs to info
func Printf(format string, v ...interface{}) {
	Info(format, v...)
}

// Println is a convenience function that logs to info
func Println(v ...interface{}) {
	if infoLog != nil {
		infoLog.Println(v...)
	}
}
