import LegalPage from "@/components/LegalPage";
import { Link } from "react-router-dom";

const Privacy = () => (
  <LegalPage
    title="Privacy Policy"
    description="PDF Palette does not collect customer accounts or keep the files you process. This page explains what does and does not happen when you use the site."
        updated="6 September 2026"
  >
    <section>
      <h2>The short version</h2>
      <p>
        We do not ask you to sign up. We do not take your documents as customer data. Most tools process
        files in your browser. PDF to Word and Word to PDF send the file to CloudConvert for
        conversion only. PDF to Word iLove sends the file to iLovePDF. PDF Palette does not keep a copy. We do not sell personal information, because
        we do not run a customer database of people or files.
      </p>
    </section>
    <section>
      <h2>Who this policy covers</h2>
      <p>
        This policy describes the PDF Palette website (the pages and tools on this domain). It is written for
        how the product works today. If that changes, we will update this page and the “Last updated” date.
      </p>
    </section>
    <section>
      <h2>Information we do not collect</h2>
      <p>We do not collect or store:</p>
      <ul>
        <li>Names, email addresses, phone numbers, or billing details as part of using the tools</li>
        <li>User accounts, passwords, or profiles</li>
        <li>The contents of PDFs, Word, Excel, PowerPoint, or image files you open in the tools</li>
        <li>A contact form or newsletter signup on this site</li>
      </ul>
      <p>
        You do not need to provide personal information to merge, convert, compress, OCR, or otherwise use
        the in-browser tools.
      </p>
    </section>
    <section>
      <h2>Where your files are processed</h2>
      <p>
        When you pick a file in a tool, it is read in your browser and processed in memory (and, where the
        browser requires it, using temporary objects on your device). The download you save is created locally.
        Closing the tab ends that in-memory work. We do not receive a copy of those files to store, index, or
        train models on.
      </p>
    </section>
    <section>
      <h2>Remote exceptions</h2>
      <p>
        <strong>PDF to Word</strong> and <strong>Word to PDF</strong> send the selected file to CloudConvert
        so it can convert it. We use that path only to return the converted file. PDF Palette
        does not keep the upload or the result after the download is ready. CloudConvert processes the file under
        CloudConvert’s own terms.
      </p>
      <p>
        <strong>PDF to Word iLove</strong> uploads the selected file to iLovePDF so their PDF to
        Word engine can convert it. PDF Palette does not keep the upload or the result after the
        download is ready. iLovePDF processes the file under iLovePDF’s own terms.
      </p>
      <p>
        If you use HTML to PDF and paste a <strong>web page URL</strong>, that URL is sent to a conversion
        service so the page can be fetched and rendered. A browser tab cannot load someone else’s website the
        way a server can. We do not use that path to build a customer list. Prefer uploading an HTML file if
        you want the conversion to stay entirely in the browser.
      </p>
      <p>
        Other tools, including OCR, merge, split, and compress, are designed to run in the browser without
        uploading your document to PDF Palette.
      </p>
    </section>
    <section>
      <h2>What your browser may store on your device</h2>
      <p>
        The site may remember your theme preference (light or dark) in your browser’s local storage. That
        setting never leaves your device as an account record. You can clear it with your browser’s site data
        controls.
      </p>
    </section>
    <section>
      <h2>Hosting and technical logs</h2>
      <p>
        The website is hosted on infrastructure that typically records ordinary web-server metadata when a page
        is requested (for example an IP address, browser user-agent, and the URL requested). Those logs exist
        to operate and secure the site. They are not a PDF Palette customer database, and they are not used to
        identify you in order to market to you. We do not attach those logs to the files you process in tools,
        because those files are not uploaded to us.
      </p>
    </section>
    <section>
      <h2>Cookies and analytics</h2>
      <p>
        PDF Palette does not set advertising cookies and does not run a third-party marketing pixel as part of
        the application. We do not use an in-app analytics product that tracks which documents you open. Your
        browser and hosting provider may still use strictly technical cookies or similar storage required to
        deliver the site.
      </p>
    </section>
    <section>
      <h2>Third parties</h2>
      <p>
        Script libraries (PDF, Office, OCR, and similar) load as part of the web app so processing can happen
        in your browser. PDF to Word and Word to PDF share the file with CloudConvert for conversion.
        PDF to Word iLove shares the file with iLovePDF for conversion.
        The HTML to PDF URL path uses the conversion service only to fetch and render that page.
      </p>
    </section>
    <section>
      <h2>Children</h2>
      <p>
        The site is a general-purpose utility. We do not knowingly collect personal information from children,
        and we do not provide features that ask anyone — including children — for personal data.
      </p>
    </section>
    <section>
      <h2>Your choices</h2>
      <p>
        Because we do not hold a customer file about you, there is no PDF Palette account to download or delete.
        You control the files on your device. You can stop using the site at any time.
      </p>
    </section>
    <section>
      <h2>Changes</h2>
      <p>
        If we ever start collecting customer data (for example accounts or server-side file storage), we will
        change this policy before that happens and describe what is collected and why. Until then, treat this
        page as the accurate description: no customer accounts, no retained document uploads to PDF Palette.
      </p>
    </section>
    <section>
      <h2>Questions</h2>
      <p>
        See <Link to="/contact">Contact</Link>. Please do not send confidential documents to public issue
        trackers.
      </p>
    </section>
  </LegalPage>
);

export default Privacy;
