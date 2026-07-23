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

# Builder alpine → bookworm-slim (glibc), khuôn currencyservice 5c. Hai lý do:
#   - KHỚP runtime distroless-debian bên dưới (cũng glibc). Payment hiện thuần
#     JS (0 file `.node`) nên musl-vs-glibc CHƯA cắn, nhưng builder cùng họ
#     libc với runtime là bảo hiểm rẻ: thêm 1 native dep sau này không âm thầm
#     đẻ binary musl rồi vỡ trên glibc.
#   - Nhất quán 2 service Node = MỘT base builder + MỘT base runtime phải theo
#     dõi khi có CVE mới, thay vì hai.
# Toolchain `apk add python3 make g++` đã bỏ ở 3c-1a (profiler gỡ → hết native
# post-install); bookworm-slim cũng không cần build-essential.
FROM --platform=$BUILDPLATFORM node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS builder

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

# `npm ci` chứ KHÔNG `npm install --only=production` — đây là fix cốt lõi của
# 3c-1, không chỉ hardening. `npm install` KHÔNG tôn trọng lockfile chặt: nó
# resolve lại và kéo về package NGOÀI lock (underscore/lodash/tmp/linkify-it),
# khiến node_modules THẬT trong image ≠ package-lock.json. Hệ quả nguy hiểm:
# Trivy SCA đọc lockfile nên MÙ với 5 package đó — image scan bắt được, SCA thì
# không (baseline EXP-3c: 32 SCA vs 41 image). `npm ci` cài ĐÚNG lockfile, không
# hơn không kém -> SCA lại phản ánh đúng artifact. `--omit=dev` bỏ devDependency.
RUN npm ci --omit=dev

# Runtime alpine → distroless (khuôn currency 5c). Đánh đổi CÓ CHỦ ĐÍCH, ghi rõ:
# alpine:3.24.1 hiện SẠCH CVE (baseline 3c-1a: image=0), distroless nodejs20-
# debian12 lại DÍNH 6 CVE libssl3 (Debian đã vá, distroless CHƯA rebuild — digest
# `2cd82015…` verify 2026-07-24 vẫn dính). Nghĩa là đổi base này làm CVE count
# XẤU đi, "0" của nó là nhờ `.trivyignore` suppress 6 ID đó (đã theo-ID nên
# payment tự cover, không thêm dòng nào — chỉ cập nhật comment ở `.trivyignore`).
# Vì sao vẫn đổi: distroless = KHÔNG shell/apt/busybox. Kẻ có RCE trong app không
# có sẵn `sh`/`curl` để leo tiếp — một tuyến phòng thủ THẬT, chặn nguyên lớp
# post-exploitation, đáng hơn 6 CVE libssl3 (đều cần điều kiện khai thác + sắp
# được vá). Alpine giữ 0-CVE-thật nhưng còn busybox shell. Đây là hardening, tách
# khỏi 3c-1a (vá CVE) để mỗi commit đúng một biến.
FROM gcr.io/distroless/nodejs20-debian12:nonroot@sha256:2cd820156cf039c8b54ae2d2a97e424b6729070714de8707a6b79f20d56f6a9a

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules

# `.dockerignore` đã loại `node_modules` → dòng này không đè node_modules vừa copy.
COPY . .

# UID dạng SỐ: K8s `runAsNonRoot: true` KHÔNG resolve username, chỉ đọc số. Đây
# là dòng làm PodSecurity `restricted` ở P5 pass mà không phải vá securityContext
# từng deployment. Payment upstream chạy root (alpine không set USER) — chính là
# thứ P5 sẽ chặn.
USER 65532:65532

# 50051 > 1024 → tiến trình nonroot bind được, không cần NET_BIND_SERVICE.
EXPOSE 50051

# KHÔNG `ENTRYPOINT ["node", "index.js"]` như bản alpine: distroless đã có sẵn
# ENTRYPOINT ["/nodejs/bin/node"], và không có shell lẫn `node` trần trong PATH
# → viết vậy là exec fail (I-014). Chỉ truyền tên script qua CMD.
CMD ["index.js"]
