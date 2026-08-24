"""
Sistema de Autenticação - Campeonato Petz 2026
"""

from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from pathlib import Path

db = SQLAlchemy()
login_manager = LoginManager()

class Acesso(db.Model):
    """Uma sessão de acesso: quem entrou, de onde e quando foi visto por último.

    A localização vem dos cabeçalhos que a própria Vercel injeta a partir do IP
    (x-vercel-ip-city / -country-region / -country) — nenhum dado é enviado a
    serviço de terceiros para geolocalizar.
    """
    __tablename__ = 'acessos'

    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, index=True)
    username = db.Column(db.String(80), index=True)
    ip = db.Column(db.String(60))
    cidade = db.Column(db.String(80))
    regiao = db.Column(db.String(80))
    pais = db.Column(db.String(8))
    user_agent = db.Column(db.String(300))
    entrou_em = db.Column(db.DateTime, default=db.func.now())
    visto_em = db.Column(db.DateTime, default=db.func.now(), index=True)


class Usuario(UserMixin, db.Model):
    __tablename__ = 'usuarios'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    senha = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(120), unique=True)
    nome_completo = db.Column(db.String(120))
    ativo = db.Column(db.Boolean, default=True)
    é_admin = db.Column(db.Boolean, default=False)
    criado_em = db.Column(db.DateTime, default=db.func.now())

    def set_password(self, senha):
        """Hash da senha"""
        self.senha = generate_password_hash(senha)

    def check_password(self, senha):
        """Verifica se a senha está correta"""
        return check_password_hash(self.senha, senha)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'nome_completo': self.nome_completo,
            'ativo': self.ativo,
            'é_admin': self.é_admin,
            'criado_em': self.criado_em.isoformat() if self.criado_em else None
        }

class UsuarioEmergencia(UserMixin):
    """Login que funciona sem banco de dados.

    Existe para o app não ficar inacessível quando o Postgres está fora do ar
    (foi o que aconteceu quando o plano do banco foi suspenso). Atende TODAS as
    contas — master e as do time —, definidas na variável de ambiente
    USUARIOS_EMERGENCIA (JSON). MASTER_SENHA_HASH continua valendo como atalho
    para uma conta master única.
    """
    def __init__(self, username, nome=None, admin=False):
        self.id = 0
        self.username = username
        self.nome_completo = nome or username
        self.email = None
        self.ativo = True
        setattr(self, 'é_admin', bool(admin))

    def get_id(self):
        # O usuário volta da sessão pelo nome, já que não há id de banco.
        return f'emergencia:{self.username}'

    def to_dict(self):
        return {
            'id': 0, 'username': self.username, 'email': None,
            'nome_completo': self.nome_completo, 'ativo': True,
            'é_admin': getattr(self, 'é_admin', False), 'emergencia': True,
        }


def _contas_emergencia():
    """Lê as contas de emergência das variáveis de ambiente.

    USUARIOS_EMERGENCIA: JSON com uma lista de
        {"username": ..., "hash": ..., "nome": ..., "admin": true/false}
    MASTER_SENHA_HASH: atalho para uma única conta master administradora.
    """
    import json
    import os
    contas = {}

    bruto = os.environ.get('USUARIOS_EMERGENCIA', '').strip()
    if bruto:
        try:
            for c in json.loads(bruto):
                u = str(c.get('username', '')).strip()
                if u and c.get('hash'):
                    contas[u] = {
                        'hash': c['hash'],
                        'nome': c.get('nome') or u,
                        'admin': bool(c.get('admin')),
                    }
        except Exception as e:
            print(f"⚠️ USUARIOS_EMERGENCIA inválida: {e}")

    h = os.environ.get('MASTER_SENHA_HASH', '').strip()
    if h and 'master' not in contas:
        contas['master'] = {'hash': h, 'nome': 'Master (modo emergência)', 'admin': True}

    return contas


def usuario_emergencia_por_nome(username):
    """Recria o usuário a partir do nome guardado na sessão."""
    c = _contas_emergencia().get(username)
    return UsuarioEmergencia(username, c['nome'], c['admin']) if c else None


def autenticar_emergencia(username, senha):
    """Confere uma conta de emergência. Retorna o usuário ou None."""
    c = _contas_emergencia().get((username or '').strip())
    if not c:
        return None
    try:
        if check_password_hash(c['hash'], senha):
            return UsuarioEmergencia(username, c['nome'], c['admin'])
    except Exception as e:
        print(f"⚠️ autenticar_emergencia falhou: {e}")
    return None


class UsuarioSessao(UserMixin):
    """Cópia leve do usuário, usada durante a sessão.

    O Flask-Login chama load_user em TODA requisição autenticada — com uma
    consulta por chamada, o app sozinho consumia ~100 mil operações por mês e
    estourou a cota do banco. Guardamos um retrato em memória por alguns
    minutos; o login sempre consulta o banco de verdade.
    """
    def __init__(self, u):
        self.id = u.id
        self.username = u.username
        self.email = u.email
        self.nome_completo = u.nome_completo
        self.ativo = u.ativo
        setattr(self, 'é_admin', getattr(u, 'é_admin', False))

    def get_id(self):
        return str(self.id)

    def to_dict(self):
        return {
            'id': self.id, 'username': self.username, 'email': self.email,
            'nome_completo': self.nome_completo, 'ativo': self.ativo,
            'é_admin': getattr(self, 'é_admin', False),
        }


_CACHE_USUARIOS = {}
CACHE_USUARIO_SEG = 600      # 10 min: mudanças de permissão valem no próximo ciclo


def invalidar_cache_usuarios():
    """Chamado quando um usuário é criado, alterado ou removido."""
    _CACHE_USUARIOS.clear()


@login_manager.user_loader
def load_user(user_id):
    import time
    if user_id == 'emergencia':                       # sessões antigas
        return usuario_emergencia_por_nome('master')
    if str(user_id).startswith('emergencia:'):
        return usuario_emergencia_por_nome(str(user_id).split(':', 1)[1])

    cached = _CACHE_USUARIOS.get(user_id)
    if cached and cached[1] > time.time():
        return cached[0]

    try:
        u = Usuario.query.get(int(user_id))
    except Exception as e:
        # Banco fora do ar: mantém a sessão com o retrato antigo, se houver.
        print(f"⚠️ load_user falhou: {e}")
        return cached[0] if cached else None

    snap = UsuarioSessao(u) if u else None
    _CACHE_USUARIOS[user_id] = (snap, time.time() + CACHE_USUARIO_SEG)
    return snap

def init_db(app):
    """Inicializa o banco de dados.
    Cria o usuário master apenas se ele ainda não existir — NUNCA sobrescreve a
    senha de um master já existente (senão a troca de senha seria desfeita a
    cada reinício)."""
    import os
    with app.app_context():
        try:
            db.create_all()
        except Exception as e:
            print(f"⚠️ Falha ao criar tabelas: {e}")
            return

        master = Usuario.query.filter_by(username='master').first()
        if not master:
            senha_inicial = os.environ.get('MASTER_PASSWORD', 'master123')
            master = Usuario(
                username='master',
                email='master@campeonato.local',
                nome_completo='Usuário Master',
                é_admin=True,
                ativo=True
            )
            master.set_password(senha_inicial)
            db.session.add(master)
            db.session.commit()
            origem = 'MASTER_PASSWORD' if os.environ.get('MASTER_PASSWORD') else 'padrão'
            print(f'✅ Usuário master criado (senha: {origem})')
        else:
            print('ℹ️ Usuário master já existe — senha preservada')
