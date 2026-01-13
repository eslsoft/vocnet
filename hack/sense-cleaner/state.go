package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"sync"
)

var stateMutex sync.Mutex

// loadProcessedWords loads processed words from state file
func loadProcessedWords(stateFile string) (map[string]bool, error) {
	file, err := os.Open(stateFile)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]bool), nil
		}
		return nil, err
	}
	defer file.Close()

	processedWords := make(map[string]bool)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		processedWords[line] = true
	}

	return processedWords, scanner.Err()
}

// appendProcessedWord appends a processed word to state file
func appendProcessedWord(stateFile string, word string) error {
	stateMutex.Lock()
	defer stateMutex.Unlock()

	file, err := os.OpenFile(stateFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("open state file: %w", err)
	}
	defer file.Close()

	_, err = fmt.Fprintf(file, "%s\n", word)
	return err
}
