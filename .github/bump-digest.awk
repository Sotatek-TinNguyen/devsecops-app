# Thay digest của ĐÚNG MỘT service trong values/dev/onlineboutique.yaml,
# giữ nguyên từng byte còn lại. Dùng bởi job `bump-gitops` (P3-3).
#
# Vì sao không phải `yq`:
#   File đích có 43/77 dòng là comment — ở project này comment CHÍNH LÀ tài liệu
#   (lý do chọn digest, service nào cố ý vắng mặt, ...). Một công cụ YAML có thể
#   reflow/đổi kiểu nháy/đánh rơi comment mà vẫn sinh ra YAML hợp lệ, và không ai
#   phát hiện cho tới lúc cần đọc lại. Không có `yq` để thử trước khi viết ⇒ chọn
#   nó là đẩy một giả định CHƯA KIỂM vào đúng file quyết định thứ gì chạy trên cụm.
#   Ở đây: dựng lại nguyên một dòng, rồi job ÉP hình dạng diff phải khớp.
#
# Vì sao không dùng {64} hay [[:space:]]:
#   Runner ubuntu-latest chạy `mawk`, không phải awk của macOS. Interval expression
#   và POSIX character class KHÔNG chắc có ở mọi bản mawk, mà đó không phải thứ đi
#   phát hiện bằng một run CI đỏ. YAML cấm tab ở indentation ⇒ `^ *` là đủ và chạy
#   trên mọi awk. Việc kiểm digest đúng 64 hex làm ở bash, nơi ERE chắc chắn có.
#
# Tham số:  -v svc=<tên service>  -v dig=<sha256:...>
# Exit:     0 = thay đúng 1 dòng · 3 = 0 hoặc >1 dòng (service vắng/đổi tên/trùng key)

# Bất kỳ key service nào ở indent 2 đều ĐÓNG block đang mở. Thiếu dòng này, một
# service không có `digest:` sẽ để cờ mở và ăn nhầm digest của service KẾ TIẾP —
# lỗi thầm lặng đúng loại khó nhìn nhất: file vẫn hợp lệ, chỉ là sai service.
/^  [A-Za-z0-9_-]+: *$/ { inblk = ($0 ~ "^  " svc ": *$") }

inblk && /^ *digest:/ {
    # Bắt indent thật rồi dựng lại dòng, thay vì regex vào GIÁ TRỊ. Digest chỉ cần
    # được ĐỊNH VỊ, không cần được khớp — nên không có regex nào phải hiểu sha256.
    match($0, /^ */)
    print substr($0, 1, RLENGTH) "digest: \"" dig "\""
    inblk = 0
    n++
    next
}

{ print }

# Đúng một lần thay, hoặc đỏ. 0 = service vắng/đổi tên; >1 = key trùng. Cả hai
# đều là hỏng ngầm nếu cho lọt: file vẫn là YAML hợp lệ, chỉ là không còn nói
# đúng thứ đang chạy.
END { if (n != 1) exit 3 }
