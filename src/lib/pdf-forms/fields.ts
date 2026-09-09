import fontkit from "@pdf-lib/fontkit";
import {
  PDFBool,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";

export class PdfFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfFormError";
  }
}

export type FieldKind = "text" | "checkbox" | "dropdown" | "options" | "radio";

export interface FormField {
  name: string;
  /** Name without the dotted parent path, which is what a reader sees. */
  label: string;
  kind: FieldKind;
  value: string;
  /** For a multi-select option list, every chosen entry. */
  values: string[];
  choices: string[];
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  /** One-based page the field's first widget sits on, when it has one. */
  page?: number;
}

function labelOf(name: string): string {
  const last = name.split(".").pop() ?? name;
  return last.replace(/_/g, " ").trim() || name;
}

async function open(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    pdf.registerFontkit(fontkit);
    return pdf;
  } catch (error) {
    if (/encrypted|password/i.test(error instanceof Error ? error.message : "")) {
      throw new PdfFormError("This PDF is password protected. Unlock it first.");
    }
    throw new PdfFormError("This file could not be read as a PDF.");
  }
}

function assertNotXfa(pdf: PDFDocument) {
  const acro = pdf.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acro?.has(PDFName.of("XFA"))) {
    throw new PdfFormError(
      "This PDF uses an XFA form, which cannot be filled here. Open it in Adobe Reader, or flatten/export it as a standard AcroForm first."
    );
  }
}

/**
 * Which page each field appears on.
 *
 * A field is a piece of data; what sits on a page is a widget annotation
 * pointing back at it. The widget's own /P entry is optional and plenty of
 * writers leave it out — so the pages' annotation lists are indexed instead.
 */
function widgetPages(pdf: PDFDocument): Map<PDFDict, number> {
  const pages = new Map<PDFDict, number>();
  pdf.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const entry = annots.lookup(i);
      if (entry instanceof PDFDict) pages.set(entry, index + 1);
    }
  });
  return pages;
}

export async function readForm(bytes: Uint8Array): Promise<FormField[]> {
  const pdf = await open(bytes);
  assertNotXfa(pdf);
  const form = pdf.getForm();
  const pages = widgetPages(pdf);

  const pageOf = (field: { acroField: { getWidgets?: () => Array<{ dict: PDFDict }> } }) => {
    for (const widget of field.acroField.getWidgets?.() ?? []) {
      const page = pages.get(widget.dict);
      if (page) return page;
    }
    return undefined;
  };

  const fields: FormField[] = [];
  for (const field of form.getFields()) {
    const name = field.getName();
    const base = {
      name,
      label: labelOf(name),
      readOnly: field.isReadOnly(),
      required: field.isRequired(),
      multiline: false,
      values: [] as string[],
      choices: [] as string[],
      page: pageOf(field as never),
    };

    if (field instanceof PDFTextField) {
      fields.push({
        ...base,
        kind: "text",
        value: field.getText() ?? "",
        multiline: field.isMultiline(),
      });
    } else if (field instanceof PDFCheckBox) {
      fields.push({ ...base, kind: "checkbox", value: field.isChecked() ? "on" : "" });
    } else if (field instanceof PDFDropdown) {
      fields.push({
        ...base,
        kind: "dropdown",
        value: field.getSelected()[0] ?? "",
        choices: field.getOptions(),
      });
    } else if (field instanceof PDFOptionList) {
      fields.push({
        ...base,
        kind: "options",
        value: "",
        values: field.getSelected(),
        choices: field.getOptions(),
      });
    } else if (field instanceof PDFRadioGroup) {
      fields.push({
        ...base,
        kind: "radio",
        value: field.getSelected() ?? "",
        choices: field.getOptions(),
      });
    }
    // Buttons and signature fields have nothing to fill in.
  }

  fields.sort((a, b) => (a.page ?? 1e6) - (b.page ?? 1e6));
  return fields;
}

export interface FillOptions {
  values: Record<string, string>;
  multiValues: Record<string, string[]>;
  /** Flatten the form so the answers become page content nobody can edit. */
  flatten: boolean;
}

let formFontBytes: ArrayBuffer | null = null;

async function loadFormFont(): Promise<ArrayBuffer> {
  if (formFontBytes) return formFontBytes;
  const res = await fetch("/fonts/DejaVuSans.ttf");
  if (!res.ok) {
    throw new PdfFormError("Could not load the form font.");
  }
  formFontBytes = await res.arrayBuffer();
  return formFontBytes;
}

function markNeedAppearances(pdf: PDFDocument) {
  const acro = pdf.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acro) acro.set(PDFName.of("NeedAppearances"), PDFBool.True);
}

export async function fillForm(bytes: Uint8Array, options: FillOptions): Promise<Uint8Array> {
  const pdf = await open(bytes);
  assertNotXfa(pdf);
  const form = pdf.getForm();

  for (const field of form.getFields()) {
    const name = field.getName();
    if (field.isReadOnly()) continue;

    try {
      if (field instanceof PDFTextField) {
        const value = options.values[name];
        if (value !== undefined) field.setText(value);
      } else if (field instanceof PDFCheckBox) {
        const value = options.values[name];
        if (value !== undefined) {
          if (value) field.check();
          else field.uncheck();
        }
      } else if (field instanceof PDFDropdown) {
        const value = options.values[name];
        if (value) field.select(value);
        else if (value === "") field.clear();
      } else if (field instanceof PDFRadioGroup) {
        const value = options.values[name];
        if (value) field.select(value);
        else if (value === "") field.clear();
      } else if (field instanceof PDFOptionList) {
        const chosen = options.multiValues[name];
        if (chosen && chosen.length > 0) field.select(chosen);
        else if (chosen) field.clear();
      }
    } catch (error) {
      // One field a reader cannot satisfy must not lose the rest of the form.
      console.warn(`pdf-forms: could not set "${name}"`, error);
    }
  }

  // Draw visible field appearances. Helvetica first (small); DejaVu if the
  // answers need characters WinAnsi cannot encode (accents, Cyrillic, …).
  let appearancesOk = false;
  try {
    const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(helvetica);
    appearancesOk = true;
  } catch {
    try {
      const font = await pdf.embedFont(await loadFormFont());
      form.updateFieldAppearances(font);
      appearancesOk = true;
    } catch (inner) {
      console.warn("pdf-forms: could not refresh field appearances", inner);
      markNeedAppearances(pdf);
    }
  }

  if (options.flatten) {
    try {
      form.flatten();
    } catch (error) {
      if (!appearancesOk) {
        throw new PdfFormError(
          "Could not lock the answers for this form. Try downloading without “Lock answers”, or use simpler characters in the fields."
        );
      }
      throw new PdfFormError(
        error instanceof Error
          ? `Could not lock the answers: ${error.message}`
          : "Could not lock the answers on this form."
      );
    }
  } else if (!appearancesOk) {
    form.getFields().forEach((field) => {
      try {
        field.needsAppearancesUpdate();
      } catch {
        /* ignore fields that cannot be marked dirty */
      }
    });
    markNeedAppearances(pdf);
  }

  return pdf.save();
}
