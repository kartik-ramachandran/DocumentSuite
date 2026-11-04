import type { ViewerContext, ViewerPlugin } from '@document-suite/viewer';
import { AnnotationController } from './annotations';
import { FormController } from './forms';
import { ToolsController } from './tools';
import { WatermarkController } from './watermark';

export type { Annotation, AnnotationTool, Point, Rect } from './annotation-types';

export interface EditorPluginOptions {
  /** Set to false to leave out the document tools, whatever the documentTools setting says. */
  tools?: boolean;
}

export interface EditorPlugin extends ViewerPlugin {
  /** Annotation controls. Available once the viewer has loaded the plugin. */
  readonly annotations: AnnotationController | null;
}

/** Adds annotations, form filling and the document tools to a viewer. */
export function createEditorPlugin(options: EditorPluginOptions = {}): EditorPlugin {
  let annotations: AnnotationController | null = null;
  let forms: FormController | null = null;

  return {
    name: 'editor',
    get annotations() {
      return annotations;
    },

    install(context: ViewerContext) {
      const { settings } = context;

      // Installed first, so that annotations and form fields sit above it.
      const watermark = new WatermarkController(context);
      watermark.install();

      if (settings.formFilling) {
        forms = new FormController(context);
        forms.install();
      }

      if (settings.annotations) {
        const controller = new AnnotationController(context);
        annotations = controller;
        controller.install();
        context.addExportStep(async (bytes) => {
          const items = controller.getAnnotations();
          if (items.length === 0) return bytes;
          // The PDF writer is large, so it's only loaded when there's something to write.
          const { writeAnnotations } = await import('./pdf-export');
          return writeAnnotations(bytes, items);
        });
      } else {
        annotations = null;
      }

      if (options.tools !== false && settings.documentTools) new ToolsController(context, context.hasService, watermark).install();
    },

    destroy() {
      annotations?.destroy();
      forms?.destroy();
    },
  };
}
