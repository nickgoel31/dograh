import os
import re

routes_to_protect = [
    "api/routes/organization.py",
    "api/routes/telephony.py",
    "api/routes/user.py",
    "api/routes/credentials.py",
    "api/routes/service_keys.py"
]

def update_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if we need to import require_role and UserRole
    if "require_role" not in content and "get_user" in content:
        content = content.replace("from api.services.auth.depends import get_user", "from api.services.auth.depends import get_user, require_role\nfrom api.enums import UserRole")
    elif "from api.enums import" in content and "UserRole" not in content:
        content = re.sub(r"from api\.enums import (.*?)\n", r"from api.enums import \1, UserRole\n", content)
        content = content.replace("from api.services.auth.depends import get_user", "from api.services.auth.depends import get_user, require_role")
    
    # Replace the dependency
    content = re.sub(
        r"(user:\s*UserModel\s*=\s*Depends\()get_user(\))", 
        r"\1require_role([UserRole.ADMIN])\2", 
        content
    )
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Updated {path}")

for route in routes_to_protect:
    full_path = os.path.join(os.getcwd(), route)
    if os.path.exists(full_path):
        update_file(full_path)
