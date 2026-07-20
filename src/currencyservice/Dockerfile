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

# ─────────────────────────────────────────────────────────────
# Builder KHÔNG còn bắt buộc phải glibc: `@google-cloud/profiler` (dependency
# native duy nhất trong cây, kéo theo pprof/node-gyp) đã gỡ khỏi package.json.
# Verify: sau `npm install`, không package nào còn `hasInstallScript` ngoài
# `protobufjs` (script đó thuần JS, chỉ check version — không compile), và
# không còn file `.node` nào trong node_modules. Vẫn giữ bookworm-slim thay vì
# quay lại alpine: digest này đã pin + chạy XANH thật ở 5c, đổi base image lúc
# này là churn không cần, không phải fix gì.
# ─────────────────────────────────────────────────────────────
ARG BUILDPLATFORM=linux/amd64

FROM --platform=$BUILDPLATFORM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS builder

WORKDIR /usr/src/app

# Chỉ copy manifest trước -> layer cài dep chỉ vỡ cache khi dependency đổi,
# không vỡ mỗi lần sửa một dòng server.js.
COPY package.json package-lock.json ./

# `npm ci` chứ KHÔNG `npm install --only=production`:
#   - ci dựng đúng cây trong lockfile, và FAIL nếu package.json lệch lockfile.
#     Đúng thứ ta cần ở supply chain: build không được phép âm thầm resolve
#     version khác với cái đã review/quét/ký.
#   - install thì resolve lại theo semver -> cùng commit, hai thời điểm, hai
#     cây dependency khác nhau. SBOM và chữ ký khi đó nói về thứ không tái lập.
# `--omit=dev` ở service này là no-op (không có devDependencies) — giữ cho
# tường minh; giá trị nằm ở `ci`, không ở cờ omit.
RUN npm ci --omit=dev

# ─────────────────────────────────────────────────────────────
# Runtime: distroless = không shell, không apk/apt, không busybox. Kẻ tấn công
# có RCE trong app cũng không có sẵn `sh`/`curl`/`wget` để leo tiếp.
# Pin bằng DIGEST vì tag `nonroot` là con trỏ DI ĐỘNG: cùng commit hôm nay ra
# image A, mai ra image B -> chữ ký cosign + SBOM nói về thứ không tái lập.
# Digest resolve từ registry API; `config.User = "65532"` đã VERIFY, không đoán.
# ─────────────────────────────────────────────────────────────
FROM gcr.io/distroless/nodejs20-debian12:nonroot@sha256:2cd820156cf039c8b54ae2d2a97e424b6729070714de8707a6b79f20d56f6a9a

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules

# `.dockerignore` đã loại node_modules/ và client.js -> dòng này không đè lên
# node_modules vừa copy ở trên.
COPY . .

# Base đã chạy 65532, lặp lại bằng SỐ có chủ đích: hiện trong file cho
# hadolint/auditor đọc, và K8s `runAsNonRoot: true` KHÔNG resolve username —
# nó chỉ đọc UID số. Đây là dòng làm PodSecurity `restricted` ở P5 pass mà
# không phải vá securityContext từng deployment.
USER 65532:65532

# 7000 > 1024 nên tiến trình nonroot bind được, không cần NET_BIND_SERVICE.
EXPOSE 7000

# KHÔNG dùng `ENTRYPOINT ["node", "server.js"]` như bản alpine: image này đã
# có sẵn ENTRYPOINT ["/nodejs/bin/node"] (đã đọc từ image config), và
# distroless không có shell lẫn `node` trong PATH -> viết vậy là exec fail.
# Chỉ truyền tên script qua CMD, để base lo phần chạy node.
CMD ["server.js"]
