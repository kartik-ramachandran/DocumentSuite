import { PdfViewer, type PdfViewerInstance, type ViewerOptions } from '@pdf-suite/react';
import { createEditorPlugin } from '@pdf-suite/editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// Query parameters let the same demo run every mode: ?mode=server&transport=json&editor=0
const params = new URLSearchParams(location.search);

function App() {
  const viewer = useRef<PdfViewerInstance | null>(null);
  const [source, setSource] = useState(params.get('source') ?? undefined);
  const plugin = useMemo(() => (params.get('editor') === '0' ? null : createEditorPlugin()), []);

  useEffect(() => {
    const id = setInterval(() => {
      if (viewer.current) Object.assign(window, { pdfViewer: viewer.current, pdfPlugin: plugin, setDemoSource: setSource });
    }, 50);
    return () => clearInterval(id);
  }, [plugin]);

  return (
    <PdfViewer
      ref={viewer}
      source={source}
      mode={(params.get('mode') as ViewerOptions['mode']) ?? 'client'}
      serviceUrl={params.get('service') ?? 'http://localhost:8080'}
      serviceTransport={(params.get('transport') as ViewerOptions['serviceTransport']) ?? 'multipart'}
      plugins={plugin ? [plugin] : []}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
