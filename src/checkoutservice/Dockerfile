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

# 1.26.4 -> 1.26.5: KHÔNG phải bump cho vui. Go stdlib được biên dịch THẲNG vào
# binary, nên CVE của stdlib đi theo artifact chứ không nằm trong `go.mod` —
# `trivy fs` (đọc lockfile) KHÔNG BAO GIỜ thấy, chỉ `trivy image` thấy. Đây đúng
# là CVE-2026-39822 mà EXP-3a đo được: image scan đếm nhiều hơn SCA đúng 1 ở cả
# 3 leg. Sửa nó = đổi TOOLCHAIN BUILD, không phải đổi dependency.
# Directive `toolchain go1.26.4` trong go.mod cố ý GIỮ NGUYÊN: nó là SÀN, không
# phải mức ghim — toolchain 1.26.5 cài sẵn trong image vẫn được dùng vì >= sàn.
# Digest lấy đúng của productcatalogservice (đã chạy thật từ 6c) — cùng base cho
# mọi service Go thì chỉ có MỘT thứ phải theo dõi khi có CVE mới.
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
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} CGO_ENABLED=0 go build -ldflags="-s -w" -gcflags="${SKAFFOLD_GO_GCFLAGS}" -o /checkoutservice .

# PIN DIGEST + NONROOT — giống 5a đã làm cho productcatalogservice.
# Upstream để `distroless/static` trần = hai vấn đề chồng nhau:
#   - tag `latest` NGẦM: tag là con trỏ DI ĐỘNG. Cùng một commit, hôm nay ra
#     image A, mai ra image B -> chữ ký cosign + SBOM nói về một thứ không tái
#     lập được. Digest thì bất biến.
#   - biến thể KHÔNG `nonroot` chạy UID 0. K8s `runAsNonRoot: true` sẽ CHẶN pod
#     ở P5 (PodSecurity `restricted`) -> vá bây giờ, đừng để P5 phải đi vá 11
#     `securityContext` từng deployment.
# Digest xác minh 2026-07-23: tag `:nonroot` vẫn resolve về đúng sha này.
FROM gcr.io/distroless/static:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6

# Lặp lại USER dù base đã set sẵn: (1) hiện ngay trong file cho auditor/hadolint
# đọc, khỏi lần vào base image; (2) UID dạng SỐ — `runAsNonRoot` không resolve
# được username, chỉ đọc số. Port 5050 > 1024 nên nonroot bind được.
USER 65532:65532

WORKDIR /src
COPY --from=builder /checkoutservice /src/checkoutservice

# Definition of this variable is used by 'skaffold debug' to identify a golang binary.
# Default behavior - a failure prints a stack trace for the current goroutine.
# See https://golang.org/pkg/runtime/
ENV GOTRACEBACK=single

EXPOSE 5050
ENTRYPOINT ["/src/checkoutservice"]
