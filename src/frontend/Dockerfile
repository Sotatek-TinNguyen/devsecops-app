# Copyright 2020 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Define a default value so it's not empty if the builder fails to provide it
ARG BUILDPLATFORM=linux/amd64

# 1.26.4 -> 1.26.5 vá Go stdlib CVE-2026-39822. Stdlib biên dịch THẲNG vào
# binary -> CVE đi theo artifact, không nằm trong go.mod: `trivy fs` không thấy,
# chỉ `trivy image` thấy. Sửa = đổi toolchain BUILD, không phải dependency.
# `toolchain go1.26.4` trong go.mod giữ nguyên (nó là SÀN, không phải mức ghim).
# Cùng digest với productcatalogservice/checkoutservice — một base cho mọi
# service Go = chỉ một thứ phải theo dõi khi có CVE mới.
FROM --platform=$BUILDPLATFORM golang:1.26.5-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS builder
ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /src

# restore dependencies
COPY go.mod go.sum ./
RUN go mod download
COPY . .

# Skaffold passes in debug-oriented compiler flags
ARG SKAFFOLD_GO_GCFLAGS
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} CGO_ENABLED=0 go build -ldflags="-s -w" -gcflags="${SKAFFOLD_GO_GCFLAGS}" -o /go/bin/frontend .

# PIN DIGEST + NONROOT (như 5a). `distroless/static` trần = tag `latest` NGẦM
# (con trỏ di động -> cùng commit ra image khác nhau, chữ ký + SBOM nói về thứ
# không tái lập được) + chạy UID 0 (P5 PodSecurity `restricted` sẽ chặn pod).
# Digest xác minh 2026-07-23: `:nonroot` vẫn resolve về đúng sha này.
FROM gcr.io/distroless/static:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6

# UID dạng SỐ vì `runAsNonRoot` không resolve username. Port 8080 > 1024 -> bind
# được. `templates/` + `static/` chỉ ĐỌC lúc chạy nên quyền root:root 0755 mặc
# định của COPY là đủ; frontend không ghi gì xuống đĩa.
USER 65532:65532

WORKDIR /src
COPY --from=builder /go/bin/frontend /src/server
COPY ./templates ./templates
COPY ./static ./static

# Definition of this variable is used by 'skaffold debug' to identify a golang binary.
# Default behavior - a failure prints a stack trace for the current goroutine.
# See https://golang.org/pkg/runtime/
ENV GOTRACEBACK=single

EXPOSE 8080
ENTRYPOINT ["/src/server"]
