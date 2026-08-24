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
    (foi o que aconteceu quando o plano do banco foi suspenso). É ativado só
    se a variável de ambiente MASTER_SENHA_HASH estiver definida.
    """
    id = 0
    username = 'master'
    nome_completo = 'Master (modo emergência)'
    email = None
    ativo = True

    def __init__(self):
        setattr(self, 'é_admin', True)

    def get_id(self):
        return 'emergencia'

    def to_dict(self):
        return {
            'id': 0, 'username': self.username, 'email': None,
            'nome_completo': self.nome_completo, 'ativo': True,
            'é_admin': True, 'emergencia': True,
        }


def autenticar_emergencia(username, senha):
    """Confere o usuário de emergência. Retorna o usuário ou None."""
    import os
    h = os.environ.get('MASTER_SENHA_HASH', '').strip()
    if not h or username != UsuarioEmergencia.username:
        return None
    try:
        if check_password_hash(h, senha):
            return UsuarioEmergencia()
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
    if user_id == 'emergencia':
        return UsuarioEmergencia()

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
