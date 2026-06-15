import { Link, useLocation } from 'react-router-dom';
import './Header.css';

export function Header() {
  const { pathname } = useLocation();

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="logo">
          <span className="logo-name">NviroTrust</span>
        </Link>
        <nav className="nav">
          <Link to="/" className={pathname === '/' ? 'nav-link active' : 'nav-link'}>
            Home
          </Link>
          <Link to="/analyze" className={pathname === '/analyze' ? 'nav-link active' : 'nav-link'}>
            Analyze
          </Link>
        </nav>
        <Link to="/analyze" className="header-cta">
          Get Started
        </Link>
      </div>
    </header>
  );
}
