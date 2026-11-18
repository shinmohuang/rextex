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
function M.setup(opts)
  opts = opts or {}
  local bin = opts.bin or ((os.getenv("HOME") or "") .. "/.local/bin/rextex")
  local where = opts.where or "right"
  local ratio = opts.ratio or 0.4

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

    local command = { bin, "view", "--session", ctx.session_id, "--block", ctx.block_id }
    if opts.zoom then
      command[#command + 1] = "--zoom"
      command[#command + 1] = tostring(opts.zoom)
    end
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
        error("rextex is not installed on the machine this session runs on (looked for " .. bin .. "). Run install.sh there.", 0)
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
      local argv = { bin, "inline", "--session", ctx.session_id, "--block", ctx.block_id }
      if opts.inline_zoom then
        argv[#argv + 1] = "--zoom"
        argv[#argv + 1] = tostring(opts.inline_zoom)
      end
      local result, err = rex.exec(argv, { timeout = 15 })
      if result == nil then
        error("rextex is not installed on this machine (looked for " .. bin .. "): " .. tostring(err), 0)
      end
      if not result.ok then
        error((result.stderr ~= "" and result.stderr or "rextex inline failed"):gsub("%s+$", ""), 0)
      end
      return { inline = (result.stdout:gsub("%s+$", "")) }
    end,
  }

  if opts.key then
    rex.bind(opts.key, "latex_inline")
  end
  if opts.preview_key then
    rex.bind(opts.preview_key, "latex_preview")
  end
end

return M
