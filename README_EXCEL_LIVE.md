# B1 Exam Practice - Excel Live Version

This folder is the Excel-live version of the exam app.

## Run

Open:

```bat
data-manager.bat
```

The app runs at:

```text
http://127.0.0.1:8788/index.html
```

## Deploy đơn giản nhất

Nếu mục tiêu là để người khác vào làm bài online, cách đơn giản nhất với code hiện tại là:

```text
Deploy toàn bộ project lên Render hoặc Railway như một Python web service
```

Chuẩn bị sẵn trong repo:

```text
Procfile
requirements.txt
scripts/data-manager-server.py đã hỗ trợ biến môi trường PORT
```

Thiết lập khuyên dùng:

```text
Start command: python scripts/data-manager-server.py
Environment:
  EXAM_MANAGER_HOST=0.0.0.0
  EXAM_MANAGER_NO_BROWSER=1
  GEMINI_API_KEY=...
```

Lưu ý:

```text
Phù hợp nhất cho người dùng làm bài và chấm Writing online.
Phần sửa Excel/admin vẫn chạy được, nhưng dữ liệu Excel trên các host kiểu Render/Railway
không nên xem là nơi lưu trữ bền vững lâu dài nếu server bị restart/redeploy.
```

Nếu bạn muốn sửa data thường xuyên và lưu bền hơn, nên giữ Excel ở máy quản trị hoặc chuyển
dữ liệu sang database sau.

## Data Flow

```text
exports/exam-data-master.xlsx
  -> scripts/excel-data-source.py
  -> scripts/data-manager-server.py
  -> app.js
```

`data.js` is kept only as a server-side structural fallback. The browser no longer loads it directly.

## Edit Questions

Edit this file:

```text
exports/exam-data-master.xlsx
```

Useful columns:

```text
ky_nang, ma_de, part, so_cau, cau_hoi, lua_chon_A, lua_chon_B, lua_chon_C,
dap_an_dung, dap_an_chap_nhan, giai_thich, audio, dong_goc
```

For richer review explanations:

```text
giai_thich = phần giải thích ngắn, trọng tâm
ghi_chu = phần phân tích thêm để hiện chi tiết hơn trong Review đáp án
```

After saving Excel, press `Đọc lại Excel` in the browser.

You can also edit through the browser:

```text
http://127.0.0.1:8788/admin.html
```

Use `Quản lý data` from the main page, choose a row, edit the fields, then click
`Lưu vào Excel`. The admin page saves directly to `exam-data-master.xlsx` and
creates backups in:

```text
exports/backups
```

## AI Writing

Writing grading still uses Gemini through:

```text
scripts/grade-writing.py
```

Keep the API key in `.env` or `api-key.txt`. Do not paste the key into public files.
