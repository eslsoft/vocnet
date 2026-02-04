# Project Configuration
.DEFAULT_GOAL := help
PROJECT_NAME := vocnet
BINARY_NAME := vocnet

# Directories
BUILD_DIR := bin
PROTO_DIR := api/proto
GEN_DIR := api/gen
OPENAPI_DIR := api/openapi

# Tool Versions
MOCKGEN_VERSION := 1.6.0

#==============================================================================
# Help
#==============================================================================

.PHONY: help
help: ## Display available commands
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

#==============================================================================
# Setup & Dependencies
#==============================================================================

.PHONY: install-tools
install-tools: ## Install development tools
	@echo "Installing development tools..."
	go install github.com/bufbuild/buf/cmd/buf@latest
	go install github.com/golang/mock/mockgen@v$(MOCKGEN_VERSION)
	go install github.com/mikefarah/yq/v4@latest
	@echo "Tools installed successfully"

.PHONY: deps
deps: ## Download and tidy Go dependencies
	@echo "Downloading dependencies..."
	go mod download
	go mod tidy

.PHONY: setup
setup: install-tools generate ## Setup complete development environment
	@echo "Development environment setup complete!"

#==============================================================================
# Code Generation
#==============================================================================

.PHONY: generate
generate: ent-generate ## Generate all code (protobuf, ent, mocks, wire)
	@mkdir -p $(GEN_DIR) $(OPENAPI_DIR) internal/mocks
	@echo "Generating golang codes"
	go generate ./internal/...
	@echo "Generating protobuf files with buf..."
	buf dep update $(PROTO_DIR)
	buf generate
	@echo "Code generation completed"

.PHONY: ent-generate
ent-generate: ## Generate Ent client only
	@echo "Generating Ent client..."
	go generate ./internal/infrastructure/database/entschema

#==============================================================================
# Build & Run
#==============================================================================

.PHONY: build
build:  ## Build the binary
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(BINARY_NAME) .

.PHONY: run
run: ## Run the server
	@echo "Running server..."
	go run . serve

#==============================================================================
# Development
#==============================================================================

.PHONY: dev
dev: db-up ## Start full development environment (DB + server)
	@echo "Starting development server..."
	go run . serve

.PHONY: migrate
migrate: ## Run database migrations
	@echo "Running migrations..."
	go run . db-init

#==============================================================================
# Database
#==============================================================================

.PHONY: db-up
db-up: ## Start PostgreSQL database container
	@echo "Starting PostgreSQL database..."
	docker run --name $(PROJECT_NAME)-postgres \
		-e POSTGRES_DB=vocnet \
		-e POSTGRES_USER=postgres \
		-e POSTGRES_PASSWORD=postgres \
		-p 5432:5432 \
		-d postgres:15-alpine

.PHONY: db-down
db-down: ## Stop and remove PostgreSQL database container
	@echo "Stopping PostgreSQL database..."
	docker stop $(PROJECT_NAME)-postgres || true
	docker rm $(PROJECT_NAME)-postgres || true

#==============================================================================
# Testing & Quality
#==============================================================================

.PHONY: test
test: ## Run tests with coverage
	@echo "Running tests..."
	go test -v -race -coverprofile=coverage.out $(shell go list ./... | grep -v /hack)

.PHONY: test-coverage
test-coverage: test ## Generate HTML test coverage report
	@echo "Generating coverage report..."
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

.PHONY: lint
lint: ## Run golangci-lint
	@echo "Running linter..."
	golangci-lint run

.PHONY: fmt
fmt: ## Format Go code
	@echo "Formatting code..."
	go fmt ./...
	goimports -w .

#==============================================================================
# Protobuf
#==============================================================================

.PHONY: buf-lint
buf-lint: ## Lint protobuf files
	@echo "Linting protobuf files..."
	buf lint $(PROTO_DIR)

.PHONY: buf-breaking
buf-breaking: ## Check for breaking protobuf changes
	@echo "Checking for breaking changes..."
	buf breaking $(PROTO_DIR) --against '.git#branch=main'

.PHONY: buf-format
buf-format: ## Format protobuf files
	@echo "Formatting protobuf files..."
	buf format -w

#==============================================================================
# Docker
#==============================================================================

.PHONY: docker-build
docker-build: ## Build Docker image
	@echo "Building Docker image..."
	docker build -t $(PROJECT_NAME):latest .

.PHONY: docker-run
docker-run: ## Run Docker container
	@echo "Running Docker container..."
	docker run --rm -p 8080:8080 -p 9090:9090 $(PROJECT_NAME):latest

#==============================================================================
# Cleanup
#==============================================================================

.PHONY: clean
clean: ## Clean build artifacts and generated files
	@echo "Cleaning..."
	rm -rf $(BUILD_DIR)
	rm -rf $(GEN_DIR)
	rm -rf $(OPENAPI_DIR)
	rm -f coverage.out coverage.html
	@echo "Clean completed"

#==============================================================================
# Utilities
#==============================================================================

.PHONY: sense-cleaner
sense-cleaner: ## Run sense cleaner (use ARGS for flags, e.g., make sense-cleaner ARGS="-dry-run -limit 10")
	@echo "Running sense cleaner..."
	go run ./hack/sense-cleaner/... $(ARGS)

.PHONY: sense-cleaner-dry
sense-cleaner-dry: ## Run sense cleaner in dry-run mode with 10 samples
	@echo "Running sense cleaner (dry-run, 10 samples)..."
	go run ./hack/sense-cleaner/... -dry-run -limit 10

#==============================================================================
# Convenience
#==============================================================================

.PHONY: all
all: clean setup build test ## Full build pipeline (clean, setup, build, test)
