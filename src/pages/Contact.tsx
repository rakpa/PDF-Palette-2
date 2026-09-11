import LegalPage from "@/components/LegalPage";
import { Link } from "react-router-dom";

const Contact = () => (
  <LegalPage
    title="Contact"
    description="Privacy, terms, and about PDF Palette — links for how the site works."
  >
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
