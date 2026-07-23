"""
Sistema de Autenticação - Campeonato Petz 2026
"""

from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from pathlib import Path

db = SQLAlchemy()
login_manager = LoginManager()

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

@login_manager.user_loader
def load_user(user_id):
    return Usuario.query.get(int(user_id))

def init_db(app):
    """Inicializa o banco de dados"""
    with app.app_context():
        db.create_all()

        # Criar usuário master se não existir
        master = Usuario.query.filter_by(username='master').first()
        if not master:
            master = Usuario(
                username='master',
                email='master@campeonato.local',
                nome_completo='Usuário Master',
                é_admin=True,
                ativo=True
            )
            master.set_password('master123')  # Senha padrão - MUDE ISSO!
            db.session.add(master)
            db.session.commit()
            print('✅ Usuário master criado: master / master123')
