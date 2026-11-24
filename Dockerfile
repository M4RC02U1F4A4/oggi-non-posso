# syntax=docker/dockerfile:1

# One image for both halves: the frontend is built to static files, the
# backend to a static binary that serves them next to the API.
#
# Base images are pinned by digest (of the multi-platform index) so a release
# only changes what a reviewed commit changes; Dependabot moves tag and digest
# together. The release builds linux/arm64 only, natively.

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine@sha256:ecb67f987aa1a57794c91d19ade7ae0209f2f0f5496aaef9e6ae85ddf92d02ab AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
ARG VERSION=dev
# Pure Go with cgo off: the binary needs nothing from the build image.
RUN CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X main.version=${VERSION}" \
      -o /out/oggi-non-posso ./cmd/oggi-non-posso
# The data directory must exist and belong to the runtime user, or a run
# without a volume could not create the database.
RUN mkdir -p /out/data

# distroless/static: no shell, no package manager.
FROM gcr.io/distroless/static:nonroot@sha256:8ce6dd87e9823c5b48dcfb2c8604714ccb351ce59607327bcc4957448da279b5
COPY --from=backend --chown=65532:65532 /out/data /data
COPY --from=backend /out/oggi-non-posso /oggi-non-posso
COPY --from=frontend /src/dist /app/static
ENV ONP_LISTEN=:8080 \
    ONP_DB_PATH=/data/oggi-non-posso.db \
    ONP_STATIC_DIR=/app/static
# Numeric, so that an orchestrator can verify the process is not root.
USER 65532:65532
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["/oggi-non-posso"]
