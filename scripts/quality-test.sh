#!/usr/bin/env bash
set -euo pipefail

# Pipeline Quality Test Helper Script
# Provides convenient wrappers for running quality tests

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}===================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}===================================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

show_help() {
    cat << EOF
Pipeline Quality Test Helper

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    quick           Run quality tests with small sample (10 words/book)
    default         Run quality tests with all words (matches make test-quality)
    sample          Run quality tests with medium sample (30 words/book)
    full            Run quality tests with large sample (50 words/book)
    all             Run quality tests for ALL wordbooks (all words)
    baseline        Update baseline from latest test results
    compare         Compare latest results with baseline
    report          Show latest quality report
    help            Show this help message

Options:
    -v, --verbose   Show verbose test output
    -w, --wordbooks Comma-separated list of wordbooks to test

Examples:
    $0 quick                          # Quick test (10 words/book)
    $0 default                        # Default test (all words, matches make)
    $0 sample -v                      # Medium sample with verbose output
    $0 full -w "CEFR-A1,GRE"         # Full test for specific wordbooks
    $0 all                            # Test all wordbooks
    $0 baseline                       # Update baseline
    $0 compare                        # Compare with baseline
EOF
}

run_test() {
    local words_per_book="$1"
    local wordbooks="${2:-}"
    local verbose="${3:-false}"

    if [ "$words_per_book" -eq 0 ]; then
        print_header "Running Quality Tests (all words)"
    else
        print_header "Running Quality Tests (${words_per_book} words/book)"
    fi

    local test_cmd="PIPELINE_IT_WORDS_PER_BOOK=${words_per_book}"

    if [ -n "$wordbooks" ]; then
        test_cmd="$test_cmd PIPELINE_IT_WORDBOOKS=\"${wordbooks}\""
    fi

    # Set timeout based on scope (match original Makefile behavior)
    local timeout="60m"  # Default matches original make test-quality
    if [ "$words_per_book" -eq 0 ]; then
        # For "all words" tests, use longer timeout
        timeout="60m"   # Keep original 60m for default wordbooks
    elif [ "$words_per_book" -gt 100 ]; then
        timeout="120m"  # Only use longer timeout for very large samples
    fi

    # Use stdbuf like original Makefile for better output buffering
    # Remove /... to avoid multi-package buffering in Go test
    test_cmd="$test_cmd stdbuf -oL -eL go test -tags=integration -timeout=${timeout} ./internal/usecase/pipeline -run TestPipelineDataQualityGates"

    # For "default" command, always use verbose to match original Makefile behavior
    if [ "$verbose" = true ] || [ "$words_per_book" -eq 0 ]; then
        test_cmd="$test_cmd -v"
    fi

    echo "Running: $test_cmd"
    eval "$test_cmd"

    if [ $? -eq 0 ]; then
        print_success "Tests passed!"
        show_report_location
    else
        print_error "Tests failed!"
        exit 1
    fi
}

show_report_location() {
    if [ -f "reports/quality/latest.md" ]; then
        echo ""
        print_success "Reports saved to reports/quality/"
        echo "  - JSON: reports/quality/latest.json"
        echo "  - Markdown: reports/quality/latest.md"
        if [ -f "reports/quality/delta.md" ]; then
            echo "  - Delta: reports/quality/delta.md"
        fi
    fi
}

update_baseline() {
    print_header "Updating Quality Baseline"

    if [ ! -f "reports/quality/latest.json" ]; then
        print_error "No quality report found. Run tests first!"
        echo "  Try: $0 default"
        exit 1
    fi

    mkdir -p testdata/baselines/quality
    cp reports/quality/latest.json testdata/baselines/quality/baseline.json

    print_success "Baseline updated: testdata/baselines/quality/baseline.json"
    echo ""
    echo "Next steps:"
    echo "  1. Review the updated baseline"
    echo "  2. Commit: git add testdata/baselines/quality/baseline.json"
    echo "  3. Push: git commit -m 'chore: update quality baseline'"
}

compare_with_baseline() {
    print_header "Comparing with Baseline"

    if [ ! -f "testdata/baselines/quality/baseline.json" ]; then
        print_warning "No baseline found. Create one first:"
        echo "  $0 baseline"
        exit 1
    fi

    if [ ! -f "reports/quality/latest.json" ]; then
        print_error "No quality report found. Run tests first!"
        echo "  Try: $0 default"
        exit 1
    fi

    if [ -f "reports/quality/delta.md" ]; then
        cat reports/quality/delta.md
    else
        print_warning "No delta report found. Delta generation may have failed."
    fi
}

show_report() {
    print_header "Latest Quality Report"

    if [ -f "reports/quality/latest.md" ]; then
        cat reports/quality/latest.md
    else
        print_error "No quality report found. Run tests first!"
        echo "  Try: $0 default"
        exit 1
    fi
}

# Parse arguments
VERBOSE=false
WORDBOOKS=""
COMMAND="${1:-help}"

shift 2>/dev/null || true

while [ $# -gt 0 ]; do
    case "$1" in
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -w|--wordbooks)
            WORDBOOKS="$2"
            shift 2
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Execute command
case "$COMMAND" in
    quick)
        run_test 10 "$WORDBOOKS" "$VERBOSE"
        ;;
    default)
        run_test 0 "$WORDBOOKS" "$VERBOSE"  # 0 means all words (matches original Makefile behavior)
        ;;
    sample)
        run_test 30 "$WORDBOOKS" "$VERBOSE"
        ;;
    full)
        run_test 50 "$WORDBOOKS" "$VERBOSE"
        ;;
    all)
        print_header "Running Quality Tests for ALL Wordbooks"
        PIPELINE_IT_ALL_WORDBOOKS=1 PIPELINE_IT_WORDS_PER_BOOK=0 \
        go test -tags=integration -timeout=120m ./internal/usecase/pipeline \
            -run TestPipelineDataQualityGates $([ "$VERBOSE" = true ] && echo "-v")
        if [ $? -eq 0 ]; then
            print_success "All tests passed!"
            show_report_location
        else
            print_error "Tests failed!"
            exit 1
        fi
        ;;
    baseline)
        update_baseline
        ;;
    compare)
        compare_with_baseline
        ;;
    report)
        show_report
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $COMMAND"
        echo ""
        show_help
        exit 1
        ;;
esac
