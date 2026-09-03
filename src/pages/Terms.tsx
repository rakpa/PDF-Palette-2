import LegalPage from "@/components/LegalPage";
import { Link } from "react-router-dom";

const Terms = () => (
  <LegalPage
    title="Terms of Service"
    description="These terms govern use of the PDF Palette website and its in-browser tools. By using the site, you agree to them."
    updated="3 September 2026"
  >
    <section>
      <h2>Agreement</h2>
      <p>
        PDF Palette is a free web application that provides PDF and document utilities in your browser. If you
        do not agree with these terms, do not use the site.
      </p>
    </section>
    <section>
      <h2>The service</h2>
      <p>
        We provide tools such as convert, merge, split, compress, OCR, and related utilities. Except as
        described in the <Link to="/privacy">Privacy Policy</Link> (HTML to PDF from a URL), processing happens
        on your device. We do not offer document storage, user accounts, or a hosted filing system.
      </p>
      <p>
        Output quality depends on the input file. Conversions, OCR, and layout reconstruction are best-effort.
        They may be incomplete or inaccurate. You are responsible for checking results before you rely on them.
      </p>
    </section>
    <section>
      <h2>Your files and your responsibility</h2>
      <p>
        You keep whatever rights you already have in files you process. Using a tool does not transfer ownership
        of your documents to us. Because we do not take those files as customer data, we also cannot recover a
        file you did not download.
      </p>
      <p>You agree to use the tools only with content you are allowed to process, and only for lawful purposes. You must not use the site to:</p>
      <ul>
        <li>Violate copyright or other rights</li>
        <li>Commit fraud, or produce documents intended to deceive</li>
        <li>Interfere with the site or attempt to misuse infrastructure</li>
        <li>Upload or process material that is illegal where you use the service</li>
      </ul>
    </section>
    <section>
      <h2>No accounts</h2>
      <p>
        There is nothing to register for. If we add accounts later, additional terms will be posted before that
        feature is offered.
      </p>
    </section>
    <section>
      <h2>Availability</h2>
      <p>
        The site is provided “as is” and “as available.” Tools may change, break, or be withdrawn. We do not
        promise uninterrupted access, a particular conversion speed, or that a given file will succeed.
      </p>
    </section>
    <section>
      <h2>Intellectual property</h2>
      <p>
        The PDF Palette name, site design, and original code of the application are protected as applicable.
        Third-party libraries retain their own licenses. Your documents remain yours.
      </p>
    </section>
    <section>
      <h2>Disclaimer of warranties</h2>
      <p>
        To the fullest extent permitted by law, we disclaim all warranties, express or implied, including
        merchantability, fitness for a particular purpose, and non-infringement. OCR text, converted layouts,
        and compressed files may contain errors.
      </p>
    </section>
    <section>
      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, PDF Palette and its contributors are not liable for indirect,
        incidental, special, consequential, or punitive damages, or for lost data, lost profits, or business
        interruption, arising from use of the tools. If a jurisdiction does not allow some limitations, those
        limitations apply to the maximum extent allowed.
      </p>
      <p>
        Because files are processed on your device and we do not store them, we cannot restore a document you
        closed without downloading.
      </p>
    </section>
    <section>
      <h2>Changes</h2>
      <p>
        We may update these terms. The “Last updated” date will change when we do. Continued use after an
        update means you accept the revised terms.
      </p>
    </section>
    <section>
      <h2>Contact</h2>
      <p>
        Questions about these terms: <Link to="/contact">Contact</Link>.
      </p>
    </section>
  </LegalPage>
);

export default Terms;
