# 🚌 Fretado Ao Vivo - PWA com Rastreamento em Tempo Real

Aplicativo Web Progressivo (PWA) para acompanhamento e rastreamento em tempo real de ônibus fretados (ABM Tecnologia), sem necessidade de login.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/joaofrancisco019/fretado-ao-vivo)

---

## ✨ Funcionalidades Principais

* 🕒 **Previsão de Chegada no Ponto (ETA)**:
  - Exibe o horário previsto exato no relógio (`HH:mm`) e a contagem regressiva em minutos (`Chega em ~X min`).
  - Sincronizado com dados de trânsito em tempo real (Google / OSRM) e velocidade instantânea do veículo.
  - Alerta de atraso ou adiantamento em relação à tabela oficial.
* 🔍 **Busca Inteligente de Endereço**:
  - Barra de busca permanente sobre o mapa estilo Google Maps / Uber.
  - Digite qualquer endereço, local (ex: *Campinas Hall*), coordenadas ou link do Google Maps.
  - Localiza o fretado mais próximo com distância a pé (em metros), tempo de caminhada e link direto para rota no Google Maps.
* 🛰️ **Visualização com Satélite Google de Alta Definição & Trânsito Ao Vivo**:
  - Alternância rápida entre Satélite Híbrido Google, Mapa de Ruas Google e Modo Noturno.
  - Camada de fluxo de tráfego em tempo real perfeitamente alinhada.
* 📱 **Interface Minimizável & Modo Mapa Limpo (Zen View)**:
  - Recolha o painel inferior em uma barra compacta com 1 clique para visualizar o mapa inteiro.
  - Modo Mapa Limpo (`👁️`) para tela cheia 100% livre de distrações.
* 📶 **Resiliência Offline & Fallback Local**:
  - Banco de dados de itinerários e paradas pré-sincronizado para garantir que o app nunca falhe mesmo com oscilações da API remota.
  - Service Worker com estratégia *Network-First* para suporte a PWA instalável no celular.

---

## 🚀 Como Rodar Localmente

### Opção 1: Arquivo Executável (Windows)
Dê dois cliques no arquivo **`iniciar.bat`**. Ele iniciará o servidor local e abrirá automaticamente o navegador em `http://localhost:8080`.

### Opção 2: Linha de Comando (Python)
```bash
python server.py
```
Acesse no navegador: `http://localhost:8080`

---

## ☁️ Como Fazer Deploy no Vercel

1. Importe este repositório no seu painel do [Vercel](https://vercel.com).
2. O Vercel detectará automaticamente o arquivo `vercel.json` e a função serverless Python em `/api/index.py`.
3. Clique em **Deploy**. O app estará ativo e acessível na nuvem em segundos!

---

Desenvolvido com Python, Leaflet.js e APIs públicas de geolocalização.
