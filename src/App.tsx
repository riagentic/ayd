// UI — export default; the framework mounts it. Reads cell state reactively,
// calls cell methods. No transport or loading plumbing: item.status IS the UI.
// Look lives in style.css; one icon set, one size per context, one color.
import { ayd, type Codec, type Format, type QueueItem } from "./cell.ts";

/** Single-color 24px stroke icons (Lucide-style paths). */
const ICONS = {
  folder:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  folderOpen:
    "M3 8h8l2 2h8l-2 9a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2zM3 8V6a2 2 0 0 1 2-2h3l2 2",
  up: "M12 19V5M5 12l7-7 7 7",
  close: "M18 6 6 18M6 6l12 12",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  refresh: "M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6",
  link:
    "M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L12 4.1M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L12 19.9",
  search: "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0zM21 21l-4.3-4.3",
  spark:
    "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M12 8l2.2 2.8L17 12l-2.8 1.2L12 16l-2.2-2.8L7 12l2.8-1.2z",
  external:
    "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  merge: "M8 3 4 7l4 4M16 3l4 4-4 4M4 7h16M12 21V11M9 18l3 3 3-3",
  plus: "M12 5v14M5 12h14",
  trash:
    "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  stop: "M6 6h12v12H6z",
};

function Icon(
  { name, size = 16 }: { name: keyof typeof ICONS; size?: number },
) {
  return (
    <svg
      class="ico"
      width={String(size)}
      height={String(size)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

const busy = (i: QueueItem) =>
  i.status === "downloading" || i.status === "loading";

function FormatRow({ item, f }: { item: QueueItem; f: Format }) {
  const badge = f.format_id === item.bestCombined
    ? "recommended"
    : f.format_id === item.bestVideoOnly
    ? "best video"
    : f.format_id === item.bestAudioOnly
    ? "best audio"
    : "";
  const video = f.vcodec && f.vcodec !== "none";
  const audio = f.acodec && f.acodec !== "none";
  return (
    <label class={item.selected === f.format_id ? "fmt on" : "fmt"}>
      <input
        type="radio"
        name="format"
        checked={item.selected === f.format_id}
        onChange={() => ayd.select(f.format_id)}
      />
      <div class="grow">
        <div>
          <b>{f.resolution || f.ext}</b>
          {f.fps && f.resolution && <span class="faint">{f.fps}fps</span>}
        </div>
        <div class="faint sm">
          {f.ext} ·{" "}
          {video && audio
            ? "video + audio"
            : video
            ? "video only"
            : "audio only"}
        </div>
      </div>
      {badge && (
        <span t="badge" class="tag">
          <Icon name="spark" size={11} />
          {badge}
        </span>
      )}
    </label>
  );
}

function Browser() {
  return (
    <div class="card">
      <div class="bar">
        <button
          type="button"
          t="browseUp"
          class="btn"
          aria-label="Up one folder"
          onClick={() => ayd.browseUp()}
        >
          <Icon name="up" size={15} />
        </button>
        <code class="grow path">{ayd.browsePath}</code>
        <button
          type="button"
          t="browseSelect"
          class="btn primary"
          onClick={() => ayd.browseSelect()}
        >
          Select
        </button>
        <button
          type="button"
          t="browseClose"
          class="btn"
          aria-label="Close"
          onClick={() => ayd.browseClose()}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
      <div class="scroll short">
        {ayd.browseDirs.length === 0 && (
          <div class="empty">
            No folders here
          </div>
        )}
        {ayd.browseDirs.map((d) => (
          <button
            key={d.path}
            type="button"
            t={`dir-${d.name}`}
            class="dir"
            onClick={() => ayd.browse(d.path)}
          >
            <Icon name="folderOpen" />
            {d.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function QueueList() {
  const n = ayd.queue.length;
  return (
    <div class="card">
      <div class="bar">
        <Icon name="list" size={15} />
        <b>Queue</b>
        <span class="faint sm">{n} item{n === 1 ? "" : "s"}</span>
        {ayd.building && <span class="accent sm push">building…</span>}
      </div>
      {n === 0 && <div class="empty">Queue is empty — add a link above.</div>}
      {ayd.queue.map((item, i) => (
        <div
          key={item.id}
          t={`queue-${i}`}
          role="button"
          tabIndex={0}
          class={item.id === ayd.activeId ? "q on" : "q"}
          onClick={() => ayd.selectItem(item.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") ayd.selectItem(item.id);
          }}
        >
          <div class="grow">
            <div class="clip">{item.title || item.url}</div>
            <div class="faint sm">{item.statusText}</div>
          </div>
          {item.status === "downloading" && (
            <span class="accent sm num">{item.progress.toFixed(0)}%</span>
          )}
          <button
            type="button"
            t={`remove-${i}`}
            class="btn icon"
            title="Remove from queue"
            aria-label="Remove from queue"
            disabled={busy(item)}
            onClick={(e) => {
              e.stopPropagation();
              ayd.removeFromQueue(item.id);
            }}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function ItemDetails({ item }: { item: QueueItem }) {
  const working = busy(item);
  return (
    <div class="card">
      <div class="info">
        {item.thumbnail && <img src={item.thumbnail} alt="" class="thumb" />}
        <div class="grow">
          <div t="title" class="title">{item.title || item.url}</div>
          <div class="faint sm">
            {item.formats.length > 0
              ? `${item.formats.length} formats`
              : "No formats loaded yet"}
          </div>
        </div>
      </div>

      {item.status === "downloading" && (
        <div class="pad">
          <div class="row between">
            <span class="dim sm">{item.statusText}</span>
            <b t="progresspct" class="accent num">
              {item.progress.toFixed(0)}%
            </b>
          </div>
          <div class="track">
            <div t="progressbar" style={{ width: `${item.progress}%` }} />
          </div>
        </div>
      )}

      {item.error && <div t="error" class="err">{item.error}</div>}

      {item.formats.length > 0 && (
        <div class="scroll tall line">
          {item.formats.map((f) => (
            <FormatRow key={f.format_id} item={item} f={f} />
          ))}
        </div>
      )}

      <div class="bar foot">
        {working && (
          <button
            type="button"
            t="stop"
            class="btn"
            onClick={() => ayd.stop()}
          >
            <Icon name="stop" size={15} />
            Cancel
          </button>
        )}
        <button
          type="button"
          t="load"
          class="btn"
          disabled={working}
          onClick={() => ayd.loadFormats()}
        >
          <Icon name="search" size={15} />
          Get formats
        </button>
        <button
          type="button"
          t="download"
          class="btn primary"
          disabled={!item.selected || working}
          onClick={() => ayd.download()}
        >
          <Icon name="download" />
          Download
        </button>
      </div>
    </div>
  );
}

function Settings() {
  return (
    <details class="card settings">
      <summary>Access settings (cookies, user agent, client)</summary>
      <label>
        Cookies file (Netscape format, from your browser)
        <input
          t="cookies"
          class="field"
          value={ayd.cookiesPath}
          placeholder="e.g. ~/.config/ayd/cookies.txt"
          onChange={(e) => ayd.setCookiesPath(e.currentTarget.value)}
        />
        <span class="faint">
          YouTube may flag the account these cookies belong to. A spare account
          is safer.
        </span>
      </label>
      <label>
        User-Agent (leave empty for yt-dlp default)
        <input
          t="ua"
          class="field"
          value={ayd.userAgent}
          placeholder="Mozilla/5.0 (X11; Linux x86_64) …"
          onChange={(e) => ayd.setUserAgent(e.currentTarget.value)}
        />
      </label>
      <label class="row">
        Player client
        <select
          t="client"
          class="field"
          value={ayd.playerClient}
          onChange={(e) => ayd.setPlayerClient(e.currentTarget.value)}
        >
          <option value="default">Default</option>
          <option value="web">Web</option>
          <option value="tv">TV</option>
          <option value="android">Android</option>
        </select>
      </label>
    </details>
  );
}

function BuildBar() {
  return (
    <div class="card bar foot">
      <label class="row dim sm push-left">
        Codec:
        <select
          t="codecpref"
          class="field"
          value={ayd.codecPref}
          onChange={(e) => ayd.setCodecPref(e.currentTarget.value as Codec)}
        >
          <option value="h264">H.264 (compatible)</option>
          <option value="vp9-1080p">VP9 1080p (space-saving)</option>
          <option value="vp9">VP9 4K (best quality)</option>
        </select>
      </label>
      {ayd.building && (
        <button
          type="button"
          t="stopBuild"
          class="btn"
          onClick={() => ayd.stop()}
        >
          <Icon name="stop" size={15} />
          Cancel
        </button>
      )}
      <button
        type="button"
        t="optimal"
        class="btn"
        disabled={!ayd.ffmpeg || ayd.building}
        title={ayd.ffmpeg
          ? "Build the optimal version of every item in the queue, one by one"
          : "ffmpeg not found"}
        onClick={() => ayd.buildOptimal()}
      >
        <Icon name="merge" />
        {ayd.building ? "Building…" : "Build optimal version"}
      </button>
    </div>
  );
}

export default function App() {
  const active = ayd.active();
  return (
    <div class="app">
      <header class="row">
        <div class="logo">
          <Icon name="download" size={20} />
        </div>
        <div class="grow">
          <h1>ayd</h1>
          <p class="faint sm">Video downloader for YouTube links</p>
        </div>
        <button
          type="button"
          t="updateYtdlp"
          class="btn"
          title="Update yt-dlp"
          onClick={() => ayd.updateYtdlp()}
        >
          <Icon name="refresh" size={15} />
          Update
        </button>
      </header>

      <div class="card bar urlbar">
        <Icon name="link" size={17} />
        <input
          t="url"
          class="grow bare"
          aria-label="YouTube link"
          value={ayd.url}
          placeholder="Paste a YouTube link…"
          onChange={(e) => ayd.setUrl(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ayd.addToQueue();
          }}
        />
        <button
          type="button"
          t="add"
          class="btn primary"
          onClick={() => ayd.addToQueue()}
        >
          <Icon name="plus" />
          Add
        </button>
      </div>

      <div class="row">
        <button
          type="button"
          t="browse"
          class="btn"
          onClick={() => ayd.browse()}
        >
          <Icon name="folder" size={15} />
          Browse
        </button>
        <input
          t="dir"
          class="field grow"
          aria-label="Download folder"
          value={ayd.dir}
          placeholder="~/.ayd/downloads"
          onChange={(e) => ayd.setDir(e.currentTarget.value)}
        />
        <button
          type="button"
          t="open"
          class="btn"
          title="Open the download folder in your file manager"
          onClick={() => ayd.open()}
        >
          <Icon name="external" size={15} />
          Open
        </button>
      </div>

      <Settings />
      {ayd.notice && <div t="notice" class="notice">{ayd.notice}</div>}
      {ayd.error && <div t="error" class="err">{ayd.error}</div>}
      {ayd.browseOpen && <Browser />}
      <QueueList />
      {active && <ItemDetails item={active} />}
      {ayd.queue.length > 0 && <BuildBar />}
    </div>
  );
}
