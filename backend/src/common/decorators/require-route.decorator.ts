import { SetMetadata } from '@nestjs/common';
import type { ManageableRouteKey } from '../constants/manageable-routes';

export const REQUIRED_ROUTE_KEY = 'requiredRoutes';

/**
 * Exige que o usuário tenha pelo menos uma das telas liberadas.
 * Aplicado junto com o `RouteAccessGuard` — sem o guard, o decorator é inerte.
 */
export const RequireRoute = (...routes: ManageableRouteKey[]) =>
  SetMetadata(REQUIRED_ROUTE_KEY, routes);
