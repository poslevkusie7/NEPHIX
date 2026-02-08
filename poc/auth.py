import os
import secrets
from typing import Dict, Optional, Tuple

from authlib.integrations.requests_client import OAuth2Session


GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_SCOPES = ["openid", "email", "profile"]


def get_google_config() -> Dict[str, str]:
    return {
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
        "redirect_uri": os.getenv("APP_BASE_URL", "http://localhost:8501"),
    }


def build_oauth_session(
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    state: Optional[str] = None,
    token: Optional[Dict] = None,
) -> OAuth2Session:
    return OAuth2Session(
        client_id=client_id,
        client_secret=client_secret,
        scope=GOOGLE_SCOPES,
        redirect_uri=redirect_uri,
        state=state,
        token=token,
    )


def generate_state_and_nonce() -> Tuple[str, str]:
    return secrets.token_urlsafe(16), secrets.token_urlsafe(16)


def get_authorization_url(state: str, nonce: str) -> str:
    cfg = get_google_config()
    oauth = build_oauth_session(
        cfg["client_id"],
        cfg["client_secret"],
        cfg["redirect_uri"],
        state=state,
    )
    auth_url, _ = oauth.create_authorization_url(
        GOOGLE_AUTH_URL,
        nonce=nonce,
        access_type="offline",
        prompt="consent",
    )
    return auth_url


def exchange_code_for_token(code: str) -> Dict:
    cfg = get_google_config()
    oauth = build_oauth_session(
        cfg["client_id"],
        cfg["client_secret"],
        cfg["redirect_uri"],
    )
    return oauth.fetch_token(GOOGLE_TOKEN_URL, code=code)


def fetch_userinfo(token: Dict) -> Dict:
    cfg = get_google_config()
    oauth = build_oauth_session(
        cfg["client_id"],
        cfg["client_secret"],
        cfg["redirect_uri"],
        token=token,
    )
    resp = oauth.get(GOOGLE_USERINFO_URL)
    resp.raise_for_status()
    return resp.json()
