import { useEffect, useState } from "react";

import { getAuthUserApiV1UserAuthUserGet } from "@/client/sdk.gen";
import { useAuth } from "@/lib/auth";

export function useCurrentUserRole() {
  const { getAccessToken, isAuthenticated } = useAuth();
  const [role, setRole] = useState<string | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRole() {
      if (!isAuthenticated) {
        setRole(null);
        setIsSuperadmin(false);
        setLoading(false);
        return;
      }

      try {
        const token = await getAccessToken();
        if (!token) {
          setLoading(false);
          return;
        }

        const response = await getAuthUserApiV1UserAuthUserGet({
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.data) {
          setRole(response.data.role || "admin");
          setIsSuperadmin(response.data.is_superuser || false);
        }
      } catch (err) {
        console.error("Failed to fetch user role", err);
      } finally {
        setLoading(false);
      }
    }

    fetchRole();
  }, [isAuthenticated, getAccessToken]);

  return { role, isSuperadmin, loading };
}
