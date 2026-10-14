import { Component, type ErrorInfo, type ReactNode } from 'react';

// Menangkap error render di satu halaman supaya kerangka aplikasi tetap tampil.
// Pesan error ditampilkan, jadi penyebab masalah tidak tersembunyi di layar kosong.

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Halaman gagal dirender:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="space-y-4 rounded-2xl border border-bahaya/60 bg-permukaan p-5">
        <div className="space-y-1">
          <h2 className="text-lg font-bold">Halaman ini gagal ditampilkan</h2>
          <p className="text-sm text-redup">Coba muat ulang halaman. Jika masih terjadi, kirim pesan di bawah ke pengembang.</p>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-latar p-3 text-xs text-bahaya">
          {this.state.error.message}
        </pre>
        <button type="button" className="tombol-garis w-full" onClick={() => this.setState({ error: null })}>
          Coba lagi
        </button>
      </div>
    );
  }
}
