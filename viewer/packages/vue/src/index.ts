import { createViewer, type DocumentSource, type PdfViewer as ViewerInstance, type ViewerEvents, type ViewerOptions } from '@pdf-suite/viewer';
import { defineComponent, h, onBeforeUnmount, onMounted, shallowRef, watch, type PropType } from 'vue';

/** The PDF viewer as a Vue component. A template ref's `viewer` gives access to the full API. Give it a height. */
export const PdfViewer = defineComponent({
  name: 'PdfViewer',
  props: {
    /** The document to open. Changing it opens the new document. */
    source: { type: [String, Object] as PropType<DocumentSource>, default: undefined },
    fileName: { type: String, default: undefined },
    theme: { type: String as PropType<ViewerOptions['theme']>, default: undefined },
    /** All other viewer options. They're read once, when the viewer is created. */
    options: { type: Object as PropType<Omit<ViewerOptions, 'source' | 'fileName' | 'theme'>>, default: () => ({}) },
  },
  emits: {
    documentLoaded: (_event: ViewerEvents['documentLoaded']) => true,
    documentError: (_event: ViewerEvents['documentError']) => true,
    pageChanged: (_event: ViewerEvents['pageChanged']) => true,
    zoomChanged: (_event: ViewerEvents['zoomChanged']) => true,
  },
  setup(props, { emit, expose }) {
    const host = shallowRef<HTMLDivElement>();
    const viewer = shallowRef<ViewerInstance>();
    expose({ viewer });

    onMounted(() => {
      const instance = createViewer(host.value!, { ...props.options, theme: props.theme });
      instance.on('documentLoaded', (event) => emit('documentLoaded', event));
      instance.on('documentError', (event) => emit('documentError', event));
      instance.on('pageChanged', (event) => emit('pageChanged', event));
      instance.on('zoomChanged', (event) => emit('zoomChanged', event));
      viewer.value = instance;
      if (props.source !== undefined) void instance.load(props.source, props.fileName);
    });

    watch(() => [props.source, props.fileName] as const, ([source, fileName]) => {
      if (source !== undefined) void viewer.value?.load(source, fileName);
    });
    watch(() => props.theme, (theme) => {
      if (theme) viewer.value?.setTheme(theme);
    });

    onBeforeUnmount(() => viewer.value?.destroy());

    return () => h('div', { ref: host, style: { height: '100%' } });
  },
});

export { FileList, PdfViewerModal, SettingsPanel } from './modal';
export { configureViewer, DEFAULT_SETTINGS, getViewerSettings, resetViewerSettings, SETTINGS_SCHEMA } from '@pdf-suite/viewer';
export type { PdfSuiteSettings, SettingsPanelOptions } from '@pdf-suite/viewer';
export { openContextMenu, openViewerModal } from '@pdf-suite/viewer';
export type { ContextMenuItem, FileItem, FileListOptions, FileMenuItem, ViewerModal, ViewerModalOptions } from '@pdf-suite/viewer';
export type { DocumentSource, PdfViewer as PdfViewerInstance, ViewerEvents, ViewerOptions, ZoomValue } from '@pdf-suite/viewer';
