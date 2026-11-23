-- rextex for Rex: see the LaTeX formulas in a pane as real math.
--
-- Two actions, both in the command palette under "LaTeX":
--   latex_inline   draws each formula over its own source, in the pane itself
--   latex_preview  opens a second pane that lists the formulas, larger
-- Running either one again turns it off.
--
--   require("rextex").setup{ key = "cmd+shift+m" }

local M = {}

local SHELL = "com.superlogical.terminal.shell"

-- The viewer opened for each source pane, so a second press closes it.
local viewers = {}

--- @param opts table|nil
---   bin    path to the rextex command (default ~/.local/bin/rextex)
---   key    key to bind, such as "cmd+shift+m" (default: no key)
---   where  "right" (default), "below", or "float"
---   ratio  share of the space the viewer gets, for a split (default 0.4)
---   zoom   formula size relative to the text, in the formula pane (default 1.3)
---   inline_zoom  the same for in-place rendering (default 1)
---   inline_style  "card" (default) sets each formula on a card, "plain" on the bare background
---   restore  false to leave in-place rendering off after the server restarts (default true)
function M.setup(opts)
  opts = opts or {}
  local bin = opts.bin or ((os.getenv("HOME") or "") .. "/.local/bin/rextex")
  local where = opts.where or "right"
  local ratio = opts.ratio or 0.4

  -- This file runs on your home server, but a session may live on another
  -- host, and rextex has to run there: that is where the pane's terminal is.
  -- A command for a pane is started by the host that owns the session, so it
  -- is written to find rextex in that host's own home directory.
  local function pane_command(args)
    local argv
    if opts.bin then
      argv = { opts.bin }
    else
      argv = { "/bin/sh", "-c", 'exec "$HOME/.local/bin/rextex" "$@"', "rextex" }
    end
    for _, arg in ipairs(args) do
      argv[#argv + 1] = arg
    end
    return argv
  end

  local function open(ctx)
    if not ctx.session_id or not ctx.block_id then
      error("rextex: no focused pane to read formulas from", 0)
    end

    local previous = viewers[ctx.block_id]
    if previous then
      viewers[ctx.block_id] = nil
      local _, err = rex.call("block.close", { session_id = ctx.session_id, block_id = previous })
      if err == nil then
        return
      end
      -- The viewer was already gone (closed with q): open a new one.
    end
    -- Pressing the key inside a viewer closes it.
    for source, viewer in pairs(viewers) do
      if viewer == ctx.block_id then
        viewers[source] = nil
        rex.call("block.close", { session_id = ctx.session_id, block_id = viewer })
        return
      end
    end

    local args = { "view", "--session", ctx.session_id, "--block", ctx.block_id }
    if opts.zoom then
      args[#args + 1] = "--zoom"
      args[#args + 1] = tostring(opts.zoom)
    end
    local command = pane_command(args)
    local layout = { block = { flavor = SHELL, label = "latex", options = { shell = "none", command = command } } }

    local result, err
    if where == "float" then
      result, err = rex.call("session.new_layer", {
        session_id = ctx.session_id,
        bounds = { 0.15, 0.1, 0.7, 0.75 },
        focus = true,
        layout = layout,
      })
    else
      result, err = rex.call("session.new_split", {
        session_id = ctx.session_id,
        anchor_id = ctx.block_id,
        direction = where == "below" and "vertical" or "horizontal",
        side = "after",
        ratio = 1 - ratio,
        focus = false,
        layout = layout,
      })
    end
    if err ~= nil then
      local message = tostring(err)
      if message:find("no such file or directory", 1, true) then
        -- The pane is created on the machine that runs the session, which may be
        -- another host than the one this config was written for.
        error("rextex is not installed on the machine this session runs on. Run install.sh there.", 0)
      end
      error("rextex: " .. message, 0)
    end
    if result and result.block_ids and result.block_ids[1] then
      viewers[ctx.block_id] = result.block_ids[1]
    end
  end

  rex.action{
    name = "latex_preview",
    title = "LaTeX: Show Formulas in This Pane",
    description = "Open or close a pane that draws the LaTeX formulas on screen as real math.",
    category = "LaTeX",
    keywords = "latex math formula equation rextex tex katex",
    run = open,
  }

  rex.action{
    name = "latex_inline",
    title = "LaTeX: Render Formulas in Place",
    description = "Draw the LaTeX formulas in this pane as real math, over their source. Run it again to show the source.",
    category = "LaTeX",
    keywords = "latex math formula equation rextex tex katex inline",
    run = function(ctx)
      if not ctx.session_id or not ctx.block_id then
        error("rextex: no focused pane to render formulas in", 0)
      end
      local args = { "inline", "--session", ctx.session_id, "--block", ctx.block_id }
      if opts.inline_zoom then
        args[#args + 1] = "--zoom"
        args[#args + 1] = tostring(opts.inline_zoom)
      end
      if opts.inline_style then
        args[#args + 1] = "--style"
        args[#args + 1] = tostring(opts.inline_style)
      end

      -- Try this machine first. rextex answers with status 3 when the pane
      -- belongs to a session on another host.
      local argv = { bin }
      for _, arg in ipairs(args) do
        argv[#argv + 1] = arg
      end
      local result = rex.exec(argv, { timeout = 15 })
      if result ~= nil and result.ok then
        return { inline = (result.stdout:gsub("%s+$", "")) }
      end
      if result ~= nil and result.code ~= 3 then
        error((result.stderr ~= "" and result.stderr or "rextex inline failed"):gsub("%s+$", ""), 0)
      end

      -- Not here, or rextex is not installed here: start it on the host that
      -- owns the session, in a sliver of a floating layer that closes by
      -- itself once the renderer is running in the background.
      local _, err = rex.call("session.new_layer", {
        session_id = ctx.session_id,
        bounds = { 0.9, 0.94, 0.1, 0.06 },
        focus = false,
        layout = { block = { flavor = SHELL, label = "latex", options = { shell = "none", command = pane_command(args) } } },
      })
      if err ~= nil then
        local message = tostring(err)
        if message:find("no such file or directory", 1, true) then
          error("rextex is not installed on the machine this session runs on. Run install.sh there.", 0)
        end
        error("rextex: " .. message, 0)
      end
      return { inline = "switched" }
    end,
  }

  -- This file runs when the server starts, as after a reboot. Turn in-place
  -- rendering back on in the panes that had it. rextex waits for the server
  -- to be ready and does nothing if no pane had it on.
  if opts.restore ~= false and rex.exec and rex.exec.start then
    rex.exec.start({ bin, "restore" }, { detach = true, stdout = false, stderr = false })
  end

  if opts.key then
    rex.bind(opts.key, "latex_inline")
  end
  if opts.preview_key then
    rex.bind(opts.preview_key, "latex_preview")
  end
end

return M
