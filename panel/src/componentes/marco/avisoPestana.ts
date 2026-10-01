// Aviso en la pestaña del navegador: con actividades nuevas sin revisar, el
// título lleva el número delante ("(2) DMujeres Tracking") y el ícono un
// círculo magenta con el número. Así se ve aunque la pestaña esté en segundo
// plano. Sin avisos, vuelven el título y el ícono normales.

const TITULO = 'DMujeres Tracking';
const ICONO = '/favicon.png';
const LADO = 64;

let imagenBase: Promise<HTMLImageElement> | null = null;

function cargarIcono(): Promise<HTMLImageElement> {
  imagenBase ??= new Promise((resolver, rechazar) => {
    const imagen = new Image();
    imagen.onload = () => resolver(imagen);
    imagen.onerror = rechazar;
    imagen.src = ICONO;
  });
  return imagenBase;
}

function enlaceIcono(): HTMLLinkElement {
  let enlace = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!enlace) {
    enlace = document.createElement('link');
    enlace.rel = 'icon';
    document.head.append(enlace);
  }
  return enlace;
}

export async function aplicarAvisoPestana(total: number): Promise<void> {
  const titulo = document.title.replace(/^\(\d+\+?\)\s*/, '') || TITULO;
  if (total <= 0) {
    document.title = titulo;
    enlaceIcono().href = ICONO;
    return;
  }
  const cifra = total > 99 ? '99+' : String(total);
  document.title = `(${cifra}) ${titulo}`;
  try {
    const imagen = await cargarIcono();
    const lienzo = document.createElement('canvas');
    lienzo.width = LADO;
    lienzo.height = LADO;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return;
    // Labios un poco más chicos y abajo a la izquierda para dejar sitio al círculo.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imagen, 0, 14, 46, 46);
    const radio = cifra.length > 1 ? 21 : 18;
    const cx = LADO - radio;
    const cy = radio;
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.fillStyle = '#eb0045';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${cifra.length > 2 ? 18 : cifra.length > 1 ? 22 : 26}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cifra, cx, cy + 1);
    enlaceIcono().href = lienzo.toDataURL('image/png');
  } catch {
    // Sin ícono base queda solo el número en el título.
  }
}
