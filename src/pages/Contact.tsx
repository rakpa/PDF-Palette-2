import LegalPage from "@/components/LegalPage";
import { Link } from "react-router-dom";

const Contact = () => (
  <LegalPage
    title="Contact"
    description="There is no account system and no contact form that collects your name or email. Use the public project tracker for product questions."
  >
    <section>
      <h2>How to reach us</h2>
      <p>
        PDF Palette does not run a customer support inbox or a web form that would store your personal details.
        That matches how the product works: we do not take customer data in order to use the tools.
      </p>
      <p>
        For bugs, feature ideas, and questions about the site, open an issue on the public repository:
      </p>
      <p>
        <a href="https://github.com/rakpa/PDF-Palette-2/issues" rel="noopener noreferrer" target="_blank">
          github.com/rakpa/PDF-Palette-2/issues
        </a>
      </p>
      <p>
        GitHub issues are public. Do not paste passwords, identity documents, or confidential file contents.
        If you are reporting a conversion problem, describe the steps and file type; you do not need to upload
        the original document unless you choose to and it is safe to share.
      </p>
    </section>
    <section>
      <h2>Privacy and legal</h2>
      <p>
        How files are processed: <Link to="/privacy">Privacy Policy</Link>.
        <br />
        Terms of use: <Link to="/terms">Terms of Service</Link>.
        <br />
        Who we are: <Link to="/about">About Us</Link>.
      </p>
    </section>
  </LegalPage>
);

export default Contact;
