-- Watches one pane for rextex and reports what is on it.
--
-- Run by the renderer as: rex do -s SESSION -b BLOCK watch.lua
--
-- A script keeps one connection to the server, so reading the screen takes a
-- fraction of a millisecond. Starting the rex command for every read took
-- about twenty, which is what made formulas trail behind scrolling text.
--
-- Each report is one line of JSON on standard output:
--   { "text": the screen and scrollback, "size": the pane's size,
--     "fg": theme foreground, "bg": theme background }
-- A line is written only when something in it has changed.

local session_id, block_id = rex.session_id, rex.block_id

local function method(name, args)
  return rex.call("block.method", { session_id = session_id, block_id = block_id, method = name, args = args })
end

local ACTIVE_SLEEP = 0.004 -- while the screen is changing
local IDLE_SLEEP = 0.03    -- once it has been still for a while
local ACTIVE_FOR = 1.5
local SLOW_EVERY = 1.0     -- size and theme change rarely

local last_text, last_slow = nil, ""
local size, fg, bg = nil, nil, nil
local slow_at, changed_at = -1e9, os.clock()
local failures = 0
local started = os.time()

-- os.clock counts processor time, which barely moves while we sleep, so keep
-- our own clock from the sleeps.
local now = 0

while true do
  local changed = false

  if now - slow_at >= SLOW_EVERY then
    slow_at = now
    local s, err = method("size")
    if err == nil and s then size = s end
    -- Rex derives palette entries 16 and 231 from the theme's background and
    -- foreground when its extended palette is on.
    local p = method("format", { format = "vt", extra_palette = true, max_bytes = 12000 })
    if p and p.content then
      local function entry(index)
        local r, g, b = p.content:match("%]4;" .. index .. ";rgb:(%x%x)/(%x%x)/(%x%x)")
        return r and ("#" .. r .. g .. b):lower() or nil
      end
      bg, fg = entry(16), entry(231)
    end
    local slow = rex.json.encode({ size = size, fg = fg, bg = bg })
    if slow ~= last_slow then
      last_slow = slow
      changed = true
    end
  end

  local r, err = method("format", { format = "text" })
  if err ~= nil or not r then
    failures = failures + 1
    -- The pane has closed, or the server is restarting.
    if failures >= 100 then
      io.stderr:write("rextex watch: " .. tostring(err) .. "\n")
      os.exit(1)
    end
  else
    failures = 0
    if r.content ~= last_text then
      last_text = r.content
      changed = true
    end
  end

  if changed and last_text and size then
    io.write(rex.json.encode({ text = last_text, size = size, fg = fg, bg = bg }), "\n")
    io.flush()
    changed_at = now
  end

  local pause = (now - changed_at < ACTIVE_FOR) and ACTIVE_SLEEP or IDLE_SLEEP
  rex.sleep(pause)
  now = now + pause
end
