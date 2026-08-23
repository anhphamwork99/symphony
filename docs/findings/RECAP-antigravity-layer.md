# Findings — Antigravity Layer (AntigravityAdapter)

- **Ngày:** 2026-08-22
- **Scope khảo sát:** `apps/server/src/provider/Layers/AntigravityAdapter.ts` (3455 dòng), `runtimeLayer.ts`, `ProviderHealth.ts`, `supervisedProcessTeardown.ts`
- **Trạng thái:** Investigation hoàn tất. Có 1 khoảng trống kiến trúc xác nhận (mục 4) chưa có ticket.

## 1. Tổng quan kiến trúc

- Antigravity là **CLI-wrapping adapter**: không nhúng SDK, mỗi turn spawn một process `agy` (Google Antigravity CLI) ở print-mode.
- Export `AntigravityAdapterLive` (Effect Layer), compose tại `runtimeLayer.ts:106`, đăng ký vào `ProviderAdapterRegistry` cùng Codex/Claude/Cursor/Grok/Droid/Kilo/OpenCode/Pi.
- Lệnh spawn một turn (`sendTurn`, ~dòng 2605):
  ```
  agy --conversation <id> | --new-project
      --dangerously-skip-permissions --model "<Model> (Effort)"
      --log-file agy.log --print-timeout 30m -p "<prompt>"
  ```
- Model discovery qua helper process `agy models` (timeout 15s); parse label dạng `slug<TAB>Display Name (Effort)`; default effort theo bảng cứng `DEFAULT_EFFORT_BY_MODEL`. Label luôn được rebuild khi dispatch (`resolveAntigravityCliModelLabel`) để tránh label corrupt từ CLI cũ.
- Health check (`ProviderHealth.ts:1627+`): `agy --version` (tối thiểu **1.0.12**) + `agy models` để xác minh login. Binary path từ `settings.providers.antigravity.binaryPath`.

## 2. Cơ thu thập output (capture)

- CLI print-mode không stream JSON usable ra stdout → Synara cài plugin **synara-capture** vào `~/.gemini/antigravity-cli/plugins/synara-capture/` (`plugin.json` + `capture.cjs` + `hooks.json`; thêm `mcp_config.json` nếu có agent gateway stdio proxy).
- Hook events ghi NDJSON vào `hooks.ndjson` trong runDir riêng của turn (mkdtemp). Transcript hội thoại nằm ở path cố định per conversation (`transcriptPathForConversation`).
- Adapter poll song song 75ms: `pollHookFile` (hook events) + `readTranscript` (TranscriptStep, track bằng byte offset). Từ đó chiếu thành runtime events: text item, `command_execution`, `file_change`, `web_search`, `dynamic_tool_call`.
- Gotcha hook đã xử lý (#490): hook trả `{"decision":"stop"}` KHÔNG hợp lệ với Antigravity/Claude Stop — chỉ `"block"` được nhận; trả `{}` trung lập cho mọi hook point, `{"decision":"ask"}` cho pre-tool khi inactive. Trả sai có thể treo print process sau khi assistant xong → UI kẹt "Working" (#465).

## 3. Reliability machinery

- **Terminal recovery state machine** `ineligible → grace → shadowed → final-drain → teardown`: giải quyết bài toán CLI _treo sau khi xong việc_ mà không phát stop (grace mặc định 15s, config `terminalRecoveryGraceMs`/mode; activity mới tăng `activityRevision` và hủy candidate).
- **Single terminal claimant**: `normal-close | watchdog | process-error | stop-hook | interrupt | session-stop` — chống double terminal.
- **Quarantine & cleanup fence**: cleanup runDir/gateway lease phải "proven"; thất bại → QuarantineRecord + retry reap mỗi 1s. `teardownChildProcessTree` chụp danh sách PID con cháu TRƯỚC khi signal (SIGTERM → SIGKILL), verify từng PID chết hết mới tính proven; còn sót → `ProviderProcessExitUnprovenError` + diagnostic liệt kê PID sống.
- **Bounded event ingress**: queue giới hạn dung lượng, compact event, reserve byte cho event terminal.
- Capabilities khai báo: model switch + rollback đều `restart-session`; không có live turn diff patch, compaction/import; `respondToRequest`/`respondToUserInput` unsupported (print mode không có interactive request).

## 4. ⚠️ Khoảng trống xác nhận: background job sống sót qua turn completion

**Hiện tượng (owner quan sát):** `agy` phát tín hiệu kết thúc turn nhưng vẫn còn job nền chạy; Synara chốt turn ngay nên không bao giờ nhận kết quả job nền.

**Đã xác minh là đúng, theo thiết kế hiện tại (chưa ai xử lý):**

1. Nhận event `stop` từ hook → claim `"stop-hook"` → `settleStopHook` (~dòng 1937): teardown process tree, hai lần poll cuối ("final drain") chỉ bắt được output đổ về trong vòng mili-giây, rồi chốt `turn.completed` **không kiểm tra `pendingTools` hay job nền nào cả**.
2. Sau settlement, mọi kênh nghe bị cắt:
   - `settleActiveTurn` clear `pollTimer` (dòng 1247–1249).
   - Dọn turn xóa `runDir` → mất `hooks.ndjson` + `agy.log`.
3. Output muộn bị bỏ qua vĩnh viễn: `sendTurn` kế tiếp gọi `markExistingTranscriptStepsProcessed` (dòng 1420, gọi tại 2563) nhảy byte-offset đến cuối transcript — step ghi giữa hai turn (kể cả kết quả job nền) bị skip không chiếu lên UI.
4. Recovery state machine được xây cho bài toán **ngược lại** (CLI treo không phát stop — #465/#490); không có nhánh cho "stop đến khi việc nền còn chạy".
5. Hook Stop trả `{}` trung lập → Synara không thể bảo agy "chờ, còn việc dở" ở tầng hook.

**Test gap:** `AntigravityAdapter.test.ts` có test cho late-fail sau output, final drain bắt transcript trễ — không có scenario nào cho background job sống sót qua turn completion.

**Dữ liệu còn sót:** kết quả job nền chỉ nằm trong DB nội bộ Antigravity `~/.gemini/antigravity-cli/conversations/<uuid>.db` — ngoài tầm với của Synara.

### Hướng remediation đề xuất (thứ tự ít xâm phạm nhất)

1. Chặn chốt sớm: tại thời điểm nhận `stop`, nếu `pendingTools` còn phần tử hoặc vừa thấy tool nền → hoãn settlement, dùng grace timer như recovery path.
2. Giữ đuôi nghe sau turn: giữ `runDir` + watcher giới hạn thời gian trên `transcriptPath`; output muộn phát thành item gắn thread (`runtime.warning`/item phụ) thay vì thất lạc.
3. Tầng giao thức: kiểm tra bản `agy` mới có expose lifecycle event cho background task không; nếu có thì đăng ký hook thêm là sạch nhất.

## 5. Hỏi–đáp vận hành đã xác minh

- **Stop giữa turn (Cancel):** claim `"interrupt"`, teardown process tree, chốt interrupted + mở composer ngay (fix #465 — Cancel không bao giờ no-op). Teardown unproven → vẫn báo interrupted nhưng session vào quarantine trạng thái error "new turns are blocked until cleanup succeeds", nền tự retry dọn dẹp.
- **Stop cả session:** `admissionGeneration++`, hủy mọi timer/fence, teardown, release lease, xóa session khỏi map — muốn dùng lại phải start session mới.
- **Tiếp tục hội thoại:** conversation ID được học qua hook event ngay turn đầu; các turn sau luôn `--conversation <id>` → context ngữ cảnh giữ nguyên phía server Google. Synara KHÔNG lưu nội dung hội thoại của Antigravity.
