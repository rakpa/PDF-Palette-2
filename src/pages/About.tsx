import LegalPage from "@/components/LegalPage";

const About = () => (
  <LegalPage
    title="About Us"
    description="PDF Palette is a set of free PDF tools. Most run in your browser. We do not keep the files you process."
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
      <h2>What we are not</h2>
      <p>
        We are not a document management platform. We do not offer shared workspaces, billed storage, or
        “save to your PDF Palette account.” If you need a copy of a result, download it. Closing the tab
        discards in-memory work.
      </p>
    </section>
  </LegalPage>
);

export default About;
