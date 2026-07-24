// Configuração da API
// Caminho relativo: funciona tanto localmente quanto em produção (Vercel)
const API_BASE_URL = '/api';

// Cliente da API
const api = {
    async get(endpoint) {
        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`Erro ao chamar ${endpoint}:`, error);
            throw error;
        }
    },

    async post(endpoint, data) {
        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`Erro ao chamar ${endpoint}:`, error);
            throw error;
        }
    },

    // Endpoints específicos
    async getIndicadores() {
        return this.get('/indicadores');
    },

    async getLojas() {
        return this.get('/lojas-disponiveis');
    },

    async getDadosSemanas() {
        return this.get('/dados-semanas');
    },

    async getLoja(sigla) {
        return this.get(`/loja/${sigla}`);
    },

    async compararLojas(team1, team2) {
        return this.post('/comparacao-lojas', { team1, team2 });
    }
};
