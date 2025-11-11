package cmd

import (
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
	"github.com/spf13/viper"
)

func tablesFromConfig(key string) []string {
	return normalizeTables(viper.GetStringSlice(key))
}

func normalizeTables(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		name := strings.TrimSpace(value)
		if name == "" {
			continue
		}
		result = append(result, strings.ToLower(name))
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func bindFlagToViper(key string, flag *pflag.Flag) {
	if flag == nil {
		return
	}
	cobra.CheckErr(viper.BindPFlag(key, flag))
}

type backupProgress struct {
	out         io.Writer
	operation   string
	totals      map[string]int
	counts      map[string]int
	lastPrinted map[string]int
	steps       map[string]int
}

func newBackupProgress(out io.Writer, operation string) *backupProgress {
	return &backupProgress{
		out:         out,
		operation:   operation,
		totals:      make(map[string]int),
		counts:      make(map[string]int),
		lastPrinted: make(map[string]int),
		steps:       make(map[string]int),
	}
}

func (p *backupProgress) StartTable(table string, total int) {
	if total < 0 {
		total = 0
	}
	p.totals[table] = total
	p.counts[table] = 0
	p.lastPrinted[table] = 0
	p.steps[table] = progressStep(total)
	_, _ = fmt.Fprintf(p.out, "开始%s %s (共 %d 行)\n", p.operation, table, total)
}

func (p *backupProgress) Increment(table string, delta int) {
	if delta <= 0 {
		return
	}
	current := p.counts[table] + delta
	p.counts[table] = current
	total := p.totals[table]
	step := p.steps[table]
	if step <= 0 {
		step = 1
	}
	last := p.lastPrinted[table]
	if current == total || last == 0 || current-last >= step {
		p.printProgress(table, current, total)
		p.lastPrinted[table] = current
	}
}

func (p *backupProgress) FinishTable(table string) {
	current := p.counts[table]
	total := p.totals[table]
	if current != p.lastPrinted[table] {
		p.printProgress(table, current, total)
	}
	if total > 0 {
		_, _ = fmt.Fprintf(p.out, "完成%s %s: %d/%d 行\n", p.operation, table, current, total)
	} else {
		_, _ = fmt.Fprintf(p.out, "完成%s %s: %d 行\n", p.operation, table, current)
	}
	delete(p.counts, table)
	delete(p.totals, table)
	delete(p.lastPrinted, table)
	delete(p.steps, table)
}

func (p *backupProgress) printProgress(table string, current, total int) {
	if total > 0 {
		_, _ = fmt.Fprintf(p.out, "%s进度 %s: %d/%d\n", p.operation, table, current, total)
	} else {
		_, _ = fmt.Fprintf(p.out, "%s进度 %s: 已处理 %d 行\n", p.operation, table, current)
	}
}

func progressStep(total int) int {
	if total <= 0 {
		return 1000
	}
	step := total / 20
	if step < 1 {
		step = 1
	}
	return step
}
