import mammoth from "mammoth";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export async function convertWordToPdfBrowser(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  if (!/\.docx$/i.test(file.name)) {
    throw new Error("Browser conversion supports .docx files only. Please upload a .docx document.");
  }

  onProgress?.(15, "Reading document…");

  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });

  onProgress?.(40, "Rendering pages…");

  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;padding:48px;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:12pt;line-height:1.6;";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    onProgress?.(75, "Creating PDF…");

    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const blob = pdf.output("blob");
    const baseName = file.name.replace(/\.docx$/i, "") || "document";

    onProgress?.(100, "Done");
    return { blob, filename: `${baseName}.pdf` };
  } finally {
    document.body.removeChild(container);
  }
}
