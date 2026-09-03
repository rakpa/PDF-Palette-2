import LegalPage from "@/components/LegalPage";
import { Link } from "react-router-dom";

const About = () => (
  <LegalPage
    title="About Us"
    description="PDF Palette is a set of free PDF tools that run in your browser. Convert, merge, split, compress, OCR, and edit PDFs without creating an account."
  >
    <section>
      <h2>What we build</h2>
      <p>
        PDF Palette started as a practical toolkit for everyday document work: turning a Word file into a PDF,
        merging a handful of scans, extracting pages, or making a scanned PDF searchable. The product is the
        tools themselves — not a document cloud, not a filing cabinet, and not a place to store your files.
      </p>
      <p>
        Almost every tool processes files on your device. You choose a file, the browser does the work, and you
        download the result. We do not operate user accounts, and we do not keep a customer database of the
        documents you open in the app.
      </p>
    </section>
    <section>
      <h2>How the tools work</h2>
      <p>
        The site is a web application. After it loads, PDF, Word, Excel, PowerPoint, and image conversions run
        locally in your tab using JavaScript libraries. That design is intentional: your files do not need to
        sit on our servers for the tools to function.
      </p>
      <p>
        One exception is documented on the HTML to PDF tool: if you convert a <em>web page URL</em>, the address
        has to be fetched by a conversion service because a browser tab cannot load arbitrary third-party pages
        on your behalf. Uploading an HTML file still stays in the browser. See our{" "}
        <Link to="/privacy">Privacy Policy</Link> for the details.
      </p>
    </section>
    <section>
      <h2>What we are not</h2>
      <p>
        We are not a document management platform. We do not offer shared workspaces, billed storage, or
        “save to your PDF Palette account.” If you need a copy of a result, download it. Closing the tab
        discards in-memory work.
      </p>
    </section>
    <section>
      <h2>Open development</h2>
      <p>
        The project is developed in public on{" "}
        <a href="https://github.com/rakpa/PDF-Palette-2" rel="noopener noreferrer" target="_blank">
          GitHub
        </a>
        . Feature requests and bug reports belong in{" "}
        <Link to="/contact">Contact</Link>.
      </p>
    </section>
  </LegalPage>
);

export default About;
