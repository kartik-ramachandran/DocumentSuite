import { FileList, PdfViewer, SettingsPanel, type FileItem, type PdfViewerInstance, type ViewerOptions } from '@pdf-suite/react';
import { createEditorPlugin } from '@pdf-suite/editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyDemoSettings } from '../../shared/demo-settings';
import { createSampleFiles, filesFromInput } from '../../shared/sample-files';

// Query parameters let the same demo run every mode: ?view=viewer&mode=server&transport=json&editor=0&rename=1
const params = new URLSearchParams(location.search);
applyDemoSettings();

const viewerOptions = (plugin: ReturnType<typeof createEditorPlugin> | null): ViewerOptions => ({
  mode: (params.get('mode') as ViewerOptions['mode']) ?? undefined,
  serviceUrl: params.get('service') ?? 'http://localhost:8080',
  serviceTransport: (params.get('transport') as ViewerOptions['serviceTransport']) ?? 'multipart',
  plugins: plugin ? [plugin] : [],
});

function ViewerDemo() {
  const viewer = useRef<PdfViewerInstance | null>(null);
  const [source, setSource] = useState(params.get('source') ?? undefined);
  const plugin = useMemo(() => (params.get('editor') === '0' ? null : createEditorPlugin()), []);
  const options = useMemo(() => viewerOptions(plugin), [plugin]);

  useEffect(() => {
    const id = setInterval(() => {
      if (viewer.current) Object.assign(window, { pdfViewer: viewer.current, pdfPlugin: plugin, setDemoSource: setSource });
    }, 50);
    return () => clearInterval(id);
  }, [plugin]);

  return <PdfViewer ref={viewer} source={source} {...options} />;
}

function FilesDemo() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const options = useMemo(() => viewerOptions(params.get('editor') === '0' ? null : createEditorPlugin()), []);

  useEffect(() => {
    void createSampleFiles().then(setFiles);
  }, []);

  return (
    <main style={{ maxWidth: 900, margin: '32px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22 }}>Your files</h1>
      <p>Click a file to open it, or right-click it for more actions.</p>
      <p>
        <label>
          Add files <input type="file" multiple aria-label="Add files" onChange={(event) => {
            const added = filesFromInput(event.target.files);
            setFiles((current) => [...current, ...added]);
          }} />
        </label>
      </p>
      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Settings</summary>
        <div style={{ marginTop: 12 }}><SettingsPanel storageKey="pdf-suite-demo-settings" /></div>
      </details>
      <FileList
        files={files}
        viewer={options}
        menuItems={[{ id: 'remove', label: 'Remove from list', danger: true, separator: true, onSelect: (file) => setFiles((current) => current.filter((item) => item !== file)) }]}
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(params.get('view') === 'viewer' ? <ViewerDemo /> : <FilesDemo />);
