import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <main className="app-shell landing-shell">
      <section className="landing-content">
        <span className="landing-kicker">75 BINGO</span>
        <h2>404</h2>
        <p>ይህ ገጽ አልተገኘም።</p>
        <a href="/" className="landing-start">ወደ መነሻ ተመለስ</a>
      </section>
    </main>
  );
};

export default NotFound;
