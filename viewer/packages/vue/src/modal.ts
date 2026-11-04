import { createFileList, createSettingsPanel, openViewerModal, type SettingsPanel as SettingsPanelInstance, type SettingsPanelOptions, type DocumentSource, type FileItem, type FileList as FileListInstance, type FileListOptions, type ViewerModal, type ViewerModalOptions } from '@pdf-suite/viewer';
import { defineComponent, h, onBeforeUnmount, onMounted, shallowRef, watch, type PropType } from 'vue';

/** The viewer in a movable, resizable modal. A template ref's `modal` gives access to the modal and its viewer. */
export const PdfViewerModal = defineComponent({
  name: 'PdfViewerModal',
  props: {
    /** Shows the modal while true. */
    open: { type: Boolean, default: false },
    source: { type: [String, Object] as PropType<DocumentSource>, default: undefined },
    fileName: { type: String, default: undefined },
    title: { type: String, default: undefined },
    /** All other modal and viewer options. They're read when the modal opens. */
    options: { type: Object as PropType<Omit<ViewerModalOptions, 'source' | 'fileName' | 'title' | 'onClose'>>, default: () => ({}) },
  },
  emits: {
    /** The user closed the modal. Set `open` to false in response. */
    close: () => true,
  },
  setup(props, { emit, expose }) {
    const modal = shallowRef<ViewerModal>();
    expose({ modal });

    const show = () => {
      const instance = openViewerModal({ ...props.options, title: props.title, fileName: props.fileName, onClose: () => {
        modal.value = undefined;
        emit('close');
      } });
      modal.value = instance;
      if (props.source !== undefined) void instance.load(props.source, props.fileName);
    };

    onMounted(() => {
      if (props.open) show();
    });
    watch(() => props.open, (open) => {
      if (open && !modal.value) show();
      else if (!open) void modal.value?.close(true);
    });
    watch(() => [props.source, props.fileName] as const, ([source, fileName]) => {
      if (source !== undefined) void modal.value?.load(source, fileName);
    });
    watch(() => props.title, (title) => {
      if (title) modal.value?.setTitle(title);
    });
    onBeforeUnmount(() => void modal.value?.close(true));

    return () => null;
  },
});

/** A list of files. Click to open one in the viewer modal, or right-click for its menu. */
export const FileList = defineComponent({
  name: 'FileList',
  props: {
    files: { type: Array as PropType<FileItem[]>, default: () => [] },
    /** All other list options, such as `clickAction`, `menuItems` and `viewer`. */
    options: { type: Object as PropType<Omit<FileListOptions, 'files'>>, default: () => ({}) },
  },
  setup(props, { expose }) {
    const host = shallowRef<HTMLDivElement>();
    const list = shallowRef<FileListInstance>();
    expose({ list });

    onMounted(() => {
      list.value = createFileList(host.value!, { ...props.options, files: props.files });
    });
    watch(() => props.files, (files) => list.value?.setFiles(files));
    watch(() => props.options, (options) => list.value?.setOptions(options));
    onBeforeUnmount(() => list.value?.destroy());

    return () => h('div', { ref: host });
  },
});

/** A ready-made settings screen. Changes apply straight away. */
export const SettingsPanel = defineComponent({
  name: 'SettingsPanel',
  props: {
    options: { type: Object as PropType<SettingsPanelOptions>, default: () => ({}) },
  },
  setup(props) {
    const host = shallowRef<HTMLDivElement>();
    let panel: SettingsPanelInstance | undefined;
    onMounted(() => {
      panel = createSettingsPanel(host.value!, props.options);
    });
    onBeforeUnmount(() => panel?.destroy());
    return () => h('div', { ref: host });
  },
});
