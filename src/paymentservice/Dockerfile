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

FROM --platform=$BUILDPLATFORM node:20.20.2-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

# Toolchain `apk add python3 make g++` ĐÃ GỠ: nó chỉ ở đây để build post-install
# script của @google-cloud/profiler. Gỡ profiler (EXP-3c-1) xong toàn bộ cây
# dependency thuần JS — verify: 0 file `.node`, 0 package có install-script. Còn
# giữ toolchain = mở rộng bề mặt builder vô cớ.

WORKDIR /usr/src/app

COPY package*.json ./

# `npm ci` chứ KHÔNG `npm install --only=production` — đây là fix cốt lõi của
# 3c-1, không chỉ hardening. `npm install` KHÔNG tôn trọng lockfile chặt: nó
# resolve lại và kéo về package NGOÀI lock (underscore/lodash/tmp/linkify-it),
# khiến node_modules THẬT trong image ≠ package-lock.json. Hệ quả nguy hiểm:
# Trivy SCA đọc lockfile nên MÙ với 5 package đó — image scan bắt được, SCA thì
# không (baseline EXP-3c: 32 SCA vs 41 image). `npm ci` cài ĐÚNG lockfile, không
# hơn không kém -> SCA lại phản ánh đúng artifact. `--omit=dev` bỏ devDependency.
RUN npm ci --omit=dev

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

RUN apk add --no-cache nodejs

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules

COPY . .

EXPOSE 50051

ENTRYPOINT [ "node", "index.js" ]
