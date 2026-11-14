# Always Right

Game trình duyệt tiếng Việt: bạn là kiểm duyệt viên ca đêm ở Quầy 07, Tân
Cảng 2041. Trợ lý AI MIRA trả lời công dân rất nhanh và rất tự tin. Việc của
bạn là tìm lỗi trong câu trả lời trước khi nó đến tay họ. Dành cho người
chơi 16+.

Trang tĩnh, không có bước build: HTML, CSS, JavaScript thuần, three.js tải
từ CDN, mô hình nhân vật `.glb` trong `game/models/`.

## Chạy trên máy

Game phải chạy qua HTTP (không mở trực tiếp file):

```sh
python -m http.server 3210 -d game
# rồi mở http://localhost:3210
```

## Kiểm tra

```sh
node game/check.js
```

## Deploy

Vercel phục vụ thư mục `game/` (xem `vercel.json`). Mỗi lần push lên `main`
sẽ deploy lại.
