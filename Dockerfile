FROM golang:1.25-alpine AS builder

WORKDIR /workspace

# Install build tooling and certificates required during go build (e.g. for fetching modules)
RUN apk --no-cache add ca-certificates git build-base

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN make setup

# Build linux binary inside the container to ensure compatibility
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=1 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -o /workspace/bin/vocnet .

FROM ghcr.io/astral-sh/uv:latest AS uv

FROM alpine:latest

# Install runtime dependencies:
# - ca-certificates/tzdata: HTTPS + timezone
# - python3: required by contrib source scripts
# - bash: required by contrib wrapper scripts (#!/bin/bash)
RUN apk --no-cache add ca-certificates tzdata python3 bash

# Create non-root user
RUN addgroup -g 1001 -S appuser && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G appuser -g appuser appuser

WORKDIR /app

# Copy binary from builder stage
COPY --from=builder /workspace/bin/vocnet ./vocnet
# Copy contrib source scripts (loaded from contrib/sources at runtime)
COPY --from=builder /workspace/contrib ./contrib
# Copy uv runtime binary (used by contrib/sources/wordnet wrapper)
COPY --from=uv /uv /uvx /usr/local/bin/
RUN mkdir -p /app/data

# Change ownership to non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose ports
EXPOSE 8080 9090

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Run the binary
CMD ["./vocnet", "serve"]
