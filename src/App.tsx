import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import * as exifr from "exifr";

type Format = "avif" | "webp" | "png" | "jpeg" | "jpg" | "svg";
const formats: Format[] = ["avif", "webp", "png", "jpeg", "jpg", "svg"];
const compareFormats: Format[] = ["jpeg", "webp", "avif", "png"];

type Status = "idle" | "ready" | "uploading" | "converting" | "done" | "error";

type Metadata = {
  cameraModel?: string;
  resolution?: string;
  gps?: string;
  dateTaken?: string;
};

type Comparison = {
  format: Format;
  size: number;
  url: string;
};

type Item = {
  id: string;
  file: File;
  format: Format;
  status: Status;
  message?: string;
  uploadProgress: number;
  downloadProgress: number;
  previewUrl: string;
  resultUrl?: string;
  resultName?: string;
  resultSize?: number;
  resultBlob?: Blob;
  meta?: Metadata;
  comparisons?: Comparison[];
  compareStatus?: "idle" | "working" | "done" | "error";
  compareMessage?: string;
};

type HistoryItem = {
  id: string;
  name: string;
  format: Format;
  inputSize: number;
  outputSize: number;
  savedAt: string;
};

const apiUrl = () =>
  (import.meta as { env: Record<string, string | undefined> }).env.VITE_API_URL ||
  "http://localhost:3000";

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

const percentSaved = (before: number, after: number) => {
  if (!before) return "0%";
  const value = ((before - after) / before) * 100;
  return `${value.toFixed(1)}%`;
};

const createId = () => Math.random().toString(36).slice(2, 10);

const formatGps = (lat?: number, lon?: number) => {
  if (typeof lat !== "number" || typeof lon !== "number") return undefined;
  const latLabel = lat >= 0 ? "N" : "S";
  const lonLabel = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}° ${latLabel}, ${Math.abs(lon).toFixed(5)}° ${lonLabel}`;
};

const formatDate = (value?: string | Date) => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString();
};

const labelForFormat = (format: Format) => {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "JPEG";
    case "webp":
      return "WebP";
    case "avif":
      return "AVIF";
    case "png":
      return "PNG";
    default:
      return format.toUpperCase();
  }
};

export default function App() {
  const [defaultFormat, setDefaultFormat] = useState<Format>("avif");
  const [items, setItems] = useState<Item[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [apiBaseUrl, setApiBaseUrl] = useState(apiUrl());
  const [quality, setQuality] = useState(70);
  const [lossless, setLossless] = useState(false);
  const [stripMetadata, setStripMetadata] = useState(true);
  const [autoOptimize, setAutoOptimize] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("avify-history");
    if (stored) {
      try {
        setHistory(JSON.parse(stored) as HistoryItem[]);
      } catch {
        setHistory([]);
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("avify-history", JSON.stringify(history.slice(0, 10)));
  }, [history]);

  const totalQueue = items.length;
  const completed = useMemo(
    () => items.filter((item) => item.status === "done").length,
    [items]
  );

  const updateItem = (id: string, patch: Partial<Item>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const loadMetadata = async (id: string, file: File) => {
    try {
      const data = await exifr.parse(file, {
        tiff: true,
        exif: true,
        gps: true
      });

      const make = data?.Make || "";
      const model = data?.Model || "";
      const cameraModel = `${make} ${model}`.trim() || undefined;
      const width = data?.ExifImageWidth || data?.ImageWidth;
      const height = data?.ExifImageHeight || data?.ImageHeight;
      const resolution = width && height ? `${width} × ${height}` : undefined;
      const gps = formatGps(data?.GPSLatitude, data?.GPSLongitude);
      const dateTaken = formatDate(data?.DateTimeOriginal || data?.CreateDate);

      updateItem(id, {
        meta: {
          cameraModel,
          resolution,
          gps,
          dateTaken
        }
      });
    } catch {
      updateItem(id, { meta: {} });
    }
  };

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const next: Item[] = Array.from(fileList).map((file) => {
      const id = createId();
      loadMetadata(id, file);
      return {
        id,
        file,
        format: defaultFormat,
        status: "ready",
        uploadProgress: 0,
        downloadProgress: 0,
        previewUrl: URL.createObjectURL(file)
      };
    });
    setItems((prev) => [...next, ...prev]);
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(event.target.files);
    event.target.value = "";
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    addFiles(event.dataTransfer.files);
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = () => setDragActive(false);

  const setItemFormat = (id: string, format: Format) => {
    updateItem(id, { format });
  };

  const convertItemServer = (item: Item) => {
    return new Promise<void>((resolve) => {
      updateItem(item.id, { status: "uploading", message: "Uploading…" });

      const formData = new FormData();
      formData.append("file", item.file);

      const keepMetadata = stripMetadata ? "0" : "1";
      const url = `${apiBaseUrl.replace(/\/$/, "")}/convert?format=${item.format}&keepMetadata=${keepMetadata}`;

      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.responseType = "blob";

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          updateItem(item.id, { uploadProgress: percent });
        }
      };

      xhr.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          updateItem(item.id, {
            downloadProgress: percent,
            status: "converting",
            message: "Converting…"
          });
        }
      };

      xhr.onerror = () => {
        updateItem(item.id, { status: "error", message: "Connection failed. Try again." });
        resolve();
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const blob = xhr.response as Blob;
          const objectUrl = URL.createObjectURL(blob);
          const base = item.file.name.replace(/\.[^.]+$/, "") || "converted";
          const resultName = `${base}.${item.format}`;
          updateItem(item.id, {
            status: "done",
            message: "Conversion complete.",
            resultUrl: objectUrl,
            resultName,
            resultSize: blob.size,
            resultBlob: blob,
            downloadProgress: 100
          });
          setHistory((prev) =>
            [
              {
                id: item.id,
                name: resultName,
                format: item.format,
                inputSize: item.file.size,
                outputSize: blob.size,
                savedAt: new Date().toISOString()
              },
              ...prev
            ].slice(0, 10)
          );
        } else {
          updateItem(item.id, { status: "error", message: `Conversion failed (${xhr.status}).` });
        }
        resolve();
      };

      xhr.send(formData);
    });
  };

  const compareSizes = async (item: Item) => {
    updateItem(item.id, { compareStatus: "working", compareMessage: "Comparing sizes…" });

    const results: Comparison[] = [];
    const keepMetadata = stripMetadata ? "0" : "1";

    for (const fmt of compareFormats) {
      const formData = new FormData();
      formData.append("file", item.file);

      const url = `${apiBaseUrl.replace(/\/$/, "")}/convert?format=${fmt}&keepMetadata=${keepMetadata}`;

      try {
        const res = await fetch(url, {
          method: "POST",
          body: formData
        });

        if (!res.ok) {
          throw new Error(`Status ${res.status}`);
        }

        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        results.push({ format: fmt, size: blob.size, url: objectUrl });
      } catch {
        updateItem(item.id, { compareStatus: "error", compareMessage: "Comparison failed. Try again." });
        return;
      }
    }

    updateItem(item.id, { comparisons: results, compareStatus: "done", compareMessage: "Comparison ready." });
  };

  const convertAll = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    for (const item of items) {
      if (item.status === "ready") {
        await convertItemServer(item);
      }
    }
    setIsProcessing(false);
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    const readyItems = items.filter((item) => item.status === "done" && item.resultBlob && item.resultName);
    if (!readyItems.length) return;

    readyItems.forEach((item) => {
      zip.file(item.resultName as string, item.resultBlob as Blob);
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "avify-conversions.zip";
    link.click();
    URL.revokeObjectURL(url);
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      if (target?.resultUrl) URL.revokeObjectURL(target.resultUrl);
      if (target?.comparisons) {
        target.comparisons.forEach((entry) => URL.revokeObjectURL(entry.url));
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const clearHistory = () => setHistory([]);

  return (
    <div className="app">
      <header className="hero card">
        <div className="brand">
          <img src="/logo.svg" alt="Avify logo" className="logo" />
          <div>
            <p className="eyebrow">AVIFY</p>
            <h1>Convert images instantly.</h1>
            <p className="subhead">Upload files, choose a format, and convert.</p>
          </div>
        </div>
        <div className="hero-actions">
          <select
            className="format-select"
            value={defaultFormat}
            onChange={(event) => setDefaultFormat(event.target.value as Format)}
          >
            {formats.map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
          <button className="primary" onClick={convertAll} disabled={!items.length || isProcessing}>
            {isProcessing ? "Processing…" : "Convert All"}
          </button>
          <button className="ghost" onClick={downloadZip} disabled={!completed}>
            Download ZIP
          </button>
        </div>
      </header>

      <section className="controls card">
        <div className="control">
          <label>
            <input type="checkbox" checked={autoOptimize} onChange={(event) => setAutoOptimize(event.target.checked)} />
            Auto optimize for web
          </label>
        </div>
        <div className="control">
          <label>
            <input type="checkbox" checked={lossless} onChange={(event) => setLossless(event.target.checked)} disabled={autoOptimize} />
            Lossless
          </label>
        </div>
        <div className="control">
          <label>
            <input type="checkbox" checked={stripMetadata} onChange={(event) => setStripMetadata(event.target.checked)} />
            Strip metadata
          </label>
        </div>
        <div className="control slider">
          <label>Quality: {autoOptimize ? "Auto" : quality}</label>
          <input
            type="range"
            min={30}
            max={95}
            step={1}
            value={quality}
            onChange={(event) => setQuality(Number(event.target.value))}
            disabled={autoOptimize}
          />
        </div>
      </section>

      <section
        className={`dropzone card ${dragActive ? "active" : ""}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <input id="upload" type="file" multiple onChange={onFileChange} />
        <label htmlFor="upload">
          Drag & drop images here or <span>browse files</span>
        </label>
        <p>Supports PNG, JPG, WEBP, AVIF, and SVG.</p>
      </section>

      <section className="stats">
        <div className="stat card">
          <p className="stat-label">Queue</p>
          <p className="stat-value">{totalQueue}</p>
        </div>
        <div className="stat card">
          <p className="stat-label">Completed</p>
          <p className="stat-value">{completed}</p>
        </div>
        <div className="stat card">
          <p className="stat-label">API</p>
          <p className="stat-value small">{apiBaseUrl}</p>
        </div>
      </section>

      <section className="card panel">
        <div className="panel-header">
          <div>
            <h2>Conversion queue</h2>
            <p className="hint">Track progress and download results as they finish.</p>
          </div>
          <div className="api-field">
            <label htmlFor="api">API base URL</label>
            <input
              id="api"
              type="text"
              value={apiBaseUrl}
              onChange={(event) => setApiBaseUrl(event.target.value)}
            />
          </div>
        </div>

        {!items.length ? (
          <p className="hint">No files yet. Add files to start converting.</p>
        ) : (
          <div className="queue">
            {items.map((item) => (
              <article key={item.id} className="queue-item">
                <div className="thumb">
                  <img src={item.previewUrl} alt={item.file.name} />
                </div>
                <div className="queue-info">
                  <div className="queue-title">
                    <h3>{item.file.name}</h3>
                    <span>{formatBytes(item.file.size)}</span>
                  </div>
                  <div className="queue-meta">
                    Format:
                    <select
                      className="inline-select"
                      value={item.format}
                      onChange={(event) => setItemFormat(item.id, event.target.value as Format)}
                      disabled={item.status === "uploading" || item.status === "converting"}
                    >
                      {formats.map((value) => (
                        <option key={value} value={value}>
                          {value.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                  {item.meta ? (
                    <div className="meta-grid">
                      <div>
                        <span>Camera</span>
                        <strong>{item.meta.cameraModel || "—"}</strong>
                      </div>
                      <div>
                        <span>Resolution</span>
                        <strong>{item.meta.resolution || "—"}</strong>
                      </div>
                      <div>
                        <span>GPS</span>
                        <strong>{item.meta.gps || "—"}</strong>
                      </div>
                      <div>
                        <span>Date taken</span>
                        <strong>{item.meta.dateTaken || "—"}</strong>
                      </div>
                    </div>
                  ) : null}
                  <div className="progress">
                    <div className="progress-row">
                      <span>Upload</span>
                      <span>{item.uploadProgress}%</span>
                    </div>
                    <div className="bar">
                      <div style={{ width: `${item.uploadProgress}%` }} />
                    </div>
                    <div className="progress-row">
                      <span>Convert</span>
                      <span>{item.downloadProgress}%</span>
                    </div>
                    <div className="bar">
                      <div style={{ width: `${item.downloadProgress}%` }} />
                    </div>
                  </div>
                  {item.status === "done" && item.resultSize ? (
                    <div className="queue-meta">
                      Output: {formatBytes(item.resultSize)} ({percentSaved(item.file.size, item.resultSize)} saved)
                    </div>
                  ) : null}
                  {item.message ? <p className="status-text">{item.message}</p> : null}
                  <div className="queue-actions">
                    <button
                      className="primary" 
                      onClick={() => convertItemServer(item)}
                      disabled={item.status === "uploading" || item.status === "converting"}
                    >
                      Convert
                    </button>
                    <button
                      className="ghost"
                      onClick={() => compareSizes(item)}
                      disabled={item.compareStatus === "working"}
                    >
                      {item.compareStatus === "working" ? "Comparing…" : "Compare sizes"}
                    </button>
                    {item.resultUrl && item.resultName ? (
                      <a className="ghost" href={item.resultUrl} download={item.resultName}>
                        Download
                      </a>
                    ) : null}
                    <button className="ghost" onClick={() => removeItem(item.id)}>
                      Remove
                    </button>
                  </div>

                  {item.compareMessage ? <p className="status-text">{item.compareMessage}</p> : null}

                  {item.comparisons ? (
                    <div className="compare-grid">
                      {item.comparisons.map((entry) => (
                        <div key={`${item.id}-${entry.format}`} className="compare-card">
                          <div className="compare-header">
                            <span>{labelForFormat(entry.format)}</span>
                            <strong>{formatBytes(entry.size)}</strong>
                          </div>
                          <p className="compare-meta">
                            {percentSaved(item.file.size, entry.size)} vs original
                          </p>
                          <img src={entry.url} alt={`${entry.format} preview`} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card panel">
        <div className="panel-header">
          <div>
            <h2>Recent conversions</h2>
            <p className="hint">Saved locally for quick reference.</p>
          </div>
          <button className="ghost" onClick={clearHistory} disabled={!history.length}>
            Clear history
          </button>
        </div>
        {!history.length ? (
          <p className="hint">No recent conversions yet.</p>
        ) : (
          <ul className="history">
            {history.map((entry) => (
              <li key={entry.id}>
                <span>{entry.name}</span>
                <span>
                  {formatBytes(entry.inputSize)} → {formatBytes(entry.outputSize)}
                </span>
                <span>{percentSaved(entry.inputSize, entry.outputSize)} saved</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="footer">
        <div className="footer-brand">
          <img src="/logo.svg" alt="Avify logo" className="logo small" />
          <span>AVIFY</span>
        </div>
        <p className="footer-text">Fast, simple image conversion.</p>
      </footer>
    </div>
  );
}