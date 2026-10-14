import { css } from '@emotion/css';
import { Link, Route, Routes } from 'react-router-dom';

// Classes geradas por CSS-in-JS ("css-<hash>"): seletores não devem depender delas.
const nav = css({ display: 'flex', gap: 12, padding: 16, background: '#0f172a', a: { color: '#fff' } });
const card = css({ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, margin: 16 });
const button = css({
  background: '#16a34a',
  color: '#fff',
  border: 0,
  padding: '10px 16px',
  borderRadius: 6,
});
const item = css({ padding: 4 });

export function Home() {
  return (
    <div className={card}>
      <h1>Bem-vindo à SPA</h1>
      <p>Página inicial renderizada pelo React.</p>
      <button className={button}>Começar</button>
    </div>
  );
}

export function Pricing() {
  return (
    <div className={card}>
      <h1>Planos</h1>
      <ul>
        {['Grátis', 'Pro', 'Empresa'].map((p) => (
          <li key={p} className={item}>
            {p}
          </li>
        ))}
      </ul>
      <button className={button} data-track="assinar">
        Assinar
      </button>
    </div>
  );
}

export function About() {
  return (
    <div className={card}>
      <h1>Sobre</h1>
      <p>Somos uma loja de testes.</p>
    </div>
  );
}

export function App() {
  return (
    <>
      <nav className={nav}>
        <Link to="/">Início</Link>
        <Link to="/planos">Planos</Link>
        <Link to="/sobre">Sobre</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/planos" element={<Pricing />} />
        <Route path="/sobre" element={<About />} />
      </Routes>
    </>
  );
}
