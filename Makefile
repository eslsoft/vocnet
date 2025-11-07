# Variables
.DEFAULT_GOAL := help
GOPATH ?= $(shell go env GOPATH)
GOBIN ?= $(GOPATH)/bin
PROJECT_NAME := vocnet
BINARY_NAME := vocnet

# Tool versions
PROTOC_VERSION := 3.21.12
MOCKGEN_VERSION := 1.6.0

# Directories
BUILD_DIR := bin
PROTO_DIR := api/proto
GEN_DIR := api/gen
OPENAPI_DIR := api/openapi

.PHONY: help
help: ## Display this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: install-tools
install-tools: ## Install development tools
	@echo "Installing development tools..."
	# Install buf
	go install github.com/bufbuild/buf/cmd/buf@latest
	# Install schema/codegen tools
	go install github.com/golang/mock/mockgen@v$(MOCKGEN_VERSION)
	# Install CLI utilities
	go install github.com/mikefarah/yq/v4@latest
	@echo "Tools installed successfully"

.PHONY: deps
deps: ## Download and tidy dependencies
	@echo "Downloading dependencies..."
	go mod download
	go mod tidy

.PHONY: buf-deps
buf-deps: ## Download and update buf dependencies
	@echo "Updating buf dependencies..."
	buf dep update api/proto

.PHONY: buf-lint
buf-lint: ## Lint protobuf files with buf
	@echo "Linting protobuf files..."
	buf lint api/proto

.PHONY: buf-breaking
buf-breaking: ## Check for breaking changes in protobuf files
	@echo "Checking for breaking changes..."
	buf breaking api/proto --against '.git#branch=main'

.PHONY: generate
generate: buf-deps ## Generate code from protobuf files using buf
	@echo "Generating protobuf files with buf..."
	@mkdir -p $(GEN_DIR) $(OPENAPI_DIR)
	buf generate
	@echo "Protobuf generation completed"
	@echo "Generating Ent client..."
	go generate ./internal/infrastructure/database/entschema
	@echo "Ent client generation completed"
	@echo "Generating Wire bindings..."
	go generate ./internal/app
	@echo "Wire generation completed"

.PHONY: build
build: generate ## Build the unified CLI binary
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(BINARY_NAME) .

.PHONY: run
run: ## Run the server via unified CLI
	@echo "Running server (serve)..."
	go run . serve

.PHONY: test
test:  ## Run tests
	@echo "Running tests..."
	go test -v -race -coverprofile=coverage.out ./...

.PHONY: test-coverage
test-coverage: test ## Generate test coverage report
	@echo "Generating coverage report..."
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

.PHONY: lint
lint: ## Run linter
	@echo "Running linter..."
	golangci-lint run

.PHONY: fmt
fmt: ## Format code
	@echo "Formatting code..."
	go fmt ./...
	goimports -w .

.PHONY: buf-format
buf-format: ## Format protobuf files
	@echo "Formatting protobuf files..."
	buf format -w

.PHONY: verify-buf
verify-buf: ## Verify buf configuration
	@echo "Verifying buf configuration..."
	@./scripts/verify-buf-config.sh

.PHONY: clean
clean: ## Clean build artifacts
	@echo "Cleaning..."
	rm -rf $(BUILD_DIR)
	rm -rf $(GEN_DIR)
	rm -rf $(OPENAPI_DIR)
	rm -f coverage.out coverage.html
	@echo "Clean completed"

.PHONY: docker-build
docker-build: ## Build Docker image
	@echo "Building Docker image..."
	docker build -t $(PROJECT_NAME):latest .

.PHONY: docker-run
docker-run: ## Run Docker container
	@echo "Running Docker container..."
	docker run --rm -p 8080:8080 -p 9090:9090 $(PROJECT_NAME):latest

.PHONY: db-up
db-up: ## Start PostgreSQL database using Docker
	@echo "Starting PostgreSQL database..."
	docker run --name $(PROJECT_NAME)-postgres \
		-e POSTGRES_DB=vocnet \
		-e POSTGRES_USER=postgres \
		-e POSTGRES_PASSWORD=postgres \
		-p 5432:5432 \
		-d postgres:15-alpine

.PHONY: db-down
db-down: ## Stop PostgreSQL database
	@echo "Stopping PostgreSQL database..."
	docker stop $(PROJECT_NAME)-postgres || true
	docker rm $(PROJECT_NAME)-postgres || true

.PHONY: setup
setup: install-tools deps generate ## Setup development environment
	@echo "Development environment setup complete!"

.PHONY: dev
dev: db-up run ## Start development environment

.PHONY: all
all: clean setup build test ## Clean, setup, build, and test
