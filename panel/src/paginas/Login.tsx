import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { useSesion } from '@/lib/sesion';
import { Logo } from '@/componentes/marco/Logo';
import { Boton } from '@/componentes/ui/Boton';
import { Campo, Casilla, Entrada } from '@/componentes/ui/Campo';

// Inicio de sesión: una tarjeta centrada con el logo y el formulario. La
// sesión es una cookie HttpOnly; aquí no se guarda ninguna clave (solo el
// usuario, si se pide).
export default function Login() {
  const { usuario, entrar } = useSesion();
  const navegar = useNavigate();
  const [nombre, setNombre] = useState(() => localStorage.getItem('dmj.correo') ?? '');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [recordar, setRecordar] = useState(true);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (usuario) navegar('/', { replace: true });
  }, [usuario, navegar]);

  async function alEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await entrar(nombre, clave);
      if (recordar) localStorage.setItem('dmj.correo', nombre.trim());
      else localStorage.removeItem('dmj.correo');
      navegar('/', { replace: true });
    } catch (fallo) {
      setError(fallo instanceof Error && fallo.message ? fallo.message : 'No se pudo entrar. Revisa el usuario y la clave.');
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-fondo px-4 py-10">
      <form
        onSubmit={alEnviar}
        className="w-full max-w-[380px] animate-entrar rounded-2xl border border-borde bg-superficie px-7 pt-9 pb-8 shadow-[0_8px_30px_rgb(11_37_69/0.08)]"
      >
        <Logo className="mx-auto mb-8 h-12" />
        <h1 className="text-center text-[20px] font-semibold text-marino-900">Iniciar sesión</h1>
        <p className="mt-1 mb-7 text-center text-[13px] text-texto-2">Ingresa con tu usuario del panel.</p>

          <div className="space-y-4">
            <Campo etiqueta="Usuario o correo">
              <Entrada
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                className="h-11"
              />
            </Campo>
            <Campo etiqueta="Clave">
              <span className="relative block">
                <Entrada
                  type={verClave ? 'text' : 'password'}
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="h-11 pr-11 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
                />
                <button
                  type="button"
                  onClick={() => setVerClave((v) => !v)}
                  aria-label={verClave ? 'Ocultar clave' : 'Mostrar clave'}
                  className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center text-texto-3 hover:text-marino-900"
                >
                  {verClave ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </Campo>
            <Casilla etiqueta="Recordar mi usuario" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
          </div>

          {error && (
            <p role="alert" className="mt-5 rounded-control bg-peligro-suave px-3 py-2 text-[13px] font-medium text-peligro">
              {error}
            </p>
          )}

          <Boton type="submit" variante="principal" disabled={enviando} className="mt-6 h-11 w-full text-[14px]">
            {enviando && <LoaderCircle className="size-4 animate-spin" />}
            {enviando ? 'Entrando…' : 'Entrar'}
          </Boton>
      </form>
      <p className="mt-6 text-[12px] text-texto-3">© {new Date().getFullYear()} DMujeres</p>
    </main>
  );
}
