import { useEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { AlertCircle, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import FileUploader, { type UploadedFile } from "@/components/FileUploader";
import { fillForm, readForm, PdfFormError, type FormField } from "@/lib/pdf-forms/fields";

const PdfFormFiller = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [multi, setMulti] = useState<Record<string, string[]>>({});
  const [flatten, setFlatten] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = files[0]?.file;
  const loadedFor = useRef<File | null>(null);

  useEffect(() => {
    if (!file || loadedFor.current === file) return;
    loadedFor.current = file;
    let cancelled = false;
    setLoading(true);
    setError(null);

    file
      .arrayBuffer()
      .then(async (buffer) => {
        const data = new Uint8Array(buffer);
        const found = await readForm(data);
        if (cancelled) return;
        setBytes(data);
        setFields(found);
        setValues(Object.fromEntries(found.map((f) => [f.name, f.value])));
        setMulti(Object.fromEntries(found.map((f) => [f.name, f.values])));
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause?.message ?? "This PDF could not be opened.");
        setBytes(null);
        setFields([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  const byPage = useMemo(() => {
    const groups = new Map<number | undefined, FormField[]>();
    for (const field of fields) {
      const list = groups.get(field.page);
      if (list) list.push(field);
      else groups.set(field.page, [field]);
    }
    return [...groups.entries()];
  }, [fields]);

  const save = async () => {
    if (!bytes || !file) return;
    setSaving(true);
    try {
      const output = await fillForm(bytes, { values, multiValues: multi, flatten });
      saveAs(
        new Blob([output as unknown as BlobPart], { type: "application/pdf" }),
        `${file.name.replace(/\.pdf$/i, "") || "document"}_filled.pdf`
      );
      toast.success(flatten ? "Filled and flattened." : "Form filled.");
    } catch (cause) {
      toast.error(
        cause instanceof PdfFormError || cause instanceof Error
          ? cause.message
          : "That didn't work."
      );
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    loadedFor.current = null;
    setFiles([]);
    setBytes(null);
    setFields([]);
    setError(null);
  };

  if (!bytes) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <FileUploader
          compact
          accept={{ "application/pdf": [".pdf"] }}
          maxFiles={1}
          files={files}
          onFilesChange={(next) => {
            loadedFor.current = null;
            setFiles(next);
            setError(null);
          }}
        />
        <p className="text-center text-sm text-muted-foreground">
          Upload a PDF with form fields. Every field it contains becomes something you can
          fill in here, and nothing is uploaded anywhere.
        </p>
        {loading && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading form…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="font-medium text-foreground">This PDF has no fillable fields.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            It may be a flat document or a scan. Use <strong>Edit PDF</strong> to type onto
            it instead.
          </p>
          <Button variant="outline" className="mt-4" onClick={reset}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <span className="text-sm text-muted-foreground">
          {fields.length} field{fields.length === 1 ? "" : "s"}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="flatten" checked={flatten} onCheckedChange={setFlatten} />
            <Label htmlFor="flatten" className="text-sm">
              Lock answers
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Another file
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            Download filled PDF
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {flatten
          ? "Answers will be written into the page itself, so they can be read but no longer changed."
          : "The PDF stays a form, so the answers can still be edited later."}
      </p>

      {byPage.map(([page, group]) => (
        <div key={page ?? "loose"} className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {page ? `Page ${page}` : "Other fields"}
          </h3>

          {group.map((field) => {
            const id = `f-${field.name}`;
            const label = (
              <Label htmlFor={id} className="text-sm">
                {field.label}
                {field.required && <span className="ml-1 text-destructive">*</span>}
                {field.readOnly && (
                  <span className="ml-2 text-xs text-muted-foreground">(read only)</span>
                )}
              </Label>
            );

            if (field.kind === "checkbox") {
              return (
                <div key={field.name} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    disabled={field.readOnly}
                    checked={!!values[field.name]}
                    onCheckedChange={(checked) =>
                      setValues((v) => ({ ...v, [field.name]: checked ? "on" : "" }))
                    }
                  />
                  {label}
                </div>
              );
            }

            if (field.kind === "radio" || field.kind === "dropdown") {
              return (
                <div key={field.name} className="space-y-2">
                  {label}
                  <div className="flex flex-wrap gap-2">
                    {field.choices.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        disabled={field.readOnly}
                        onClick={() =>
                          setValues((v) => ({
                            ...v,
                            [field.name]: v[field.name] === choice ? "" : choice,
                          }))
                        }
                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                          values[field.name] === choice
                            ? "border-primary bg-primary/10 font-medium text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }

            if (field.kind === "options") {
              const chosen = multi[field.name] ?? [];
              return (
                <div key={field.name} className="space-y-2">
                  {label}
                  <div className="flex flex-wrap gap-2">
                    {field.choices.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        disabled={field.readOnly}
                        onClick={() =>
                          setMulti((m) => {
                            const current = m[field.name] ?? [];
                            return {
                              ...m,
                              [field.name]: current.includes(choice)
                                ? current.filter((c) => c !== choice)
                                : [...current, choice],
                            };
                          })
                        }
                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                          chosen.includes(choice)
                            ? "border-primary bg-primary/10 font-medium text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <div key={field.name} className="space-y-2">
                {label}
                {field.multiline ? (
                  <Textarea
                    id={id}
                    rows={3}
                    disabled={field.readOnly}
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues((v) => ({ ...v, [field.name]: event.target.value }))
                    }
                  />
                ) : (
                  <Input
                    id={id}
                    disabled={field.readOnly}
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues((v) => ({ ...v, [field.name]: event.target.value }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default PdfFormFiller;
