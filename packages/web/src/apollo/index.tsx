import type { ApolloClientOptions } from '@apollo/client'
import * as apolloClient from '@apollo/client'
import { setContext } from '@apollo/client/link/context'

// Storybook doesn't like us importing directly from `apollo/client`.
const {
  ApolloProvider,
  ApolloClient,
  ApolloLink,
  HttpLink,
  InMemoryCache,
  useQuery,
  useMutation,
} = apolloClient

import type { AuthContextInterface } from '@redwoodjs/auth'
import { useAuth as useRWAuth } from '@redwoodjs/auth'
import './typeOverride'

import {
  FetchConfigProvider,
  useFetchConfig,
} from '../components/FetchConfigProvider'
import { GraphQLHooksProvider } from '../components/GraphQLHooksProvider'

export type ApolloClientCacheConfig = apolloClient.InMemoryCacheConfig
type ApolloLinkType = apolloClient.ApolloLink

export type GraphQLClientConfigProp = Omit<
  ApolloClientOptions<unknown>,
  'cache' | 'link'
> & {
  cacheConfig?: ApolloClientCacheConfig
  link?: ApolloLinkType | ((rwLink: ApolloLinkType) => ApolloLinkType)
}

export type UseAuthProp = () => AuthContextInterface

const ApolloProviderWithFetchConfig: React.FunctionComponent<{
  config?: GraphQLClientConfigProp
  useAuth: UseAuthProp
}> = ({ config = {}, children, useAuth }) => {
  /**
   * Here we're using Apollo Link to customize Apollo Client's data flow.
   *
   * Although we're sending conventional HTTP-based requests and could just pass `uri` instead of `link`,
   * we need to fetch a new token on every request, making middleware a good fit for this.
   *
   * @see {@link https://www.apollographql.com/docs/react/api/link/introduction/}
   */
  const { isAuthenticated, getToken, type } = useAuth()

  const withToken = setContext(async () => {
    if (isAuthenticated && getToken) {
      const token = await getToken()

      return { token }
    }

    return { token: null }
  })

  const { headers, uri } = useFetchConfig()

  const authMiddleware = new ApolloLink((operation, forward) => {
    const { token } = operation.getContext()

    /**
     * Only add auth headers when there's a token.
     */
    const authHeaders = token
      ? {
          'auth-provider': type,
          authorization: `Bearer ${token}`,
        }
      : {}

    operation.setContext(() => ({
      headers: {
        ...headers,
        // Duped auth headers, because we may remove FetchContext at a later date
        ...authHeaders,
      },
    }))

    return forward(operation)
  })

  /**
   * A terminating link.
   * Apollo Client uses this to send GraphQL operations to a server over HTTP.
   *
   * @see {@link https://www.apollographql.com/docs/react/api/link/introduction/#the-terminating-link}
   */
  const httpLink = new HttpLink({ uri })

  /**
   * The order here's important.
   */
  const rwLink = ApolloLink.from([withToken, authMiddleware, httpLink])

  /**
   * If the user provides a link that's a function,
   * we want to call it with our link.
   *
   * If it's not, we just want to use it.
   *
   * And if they don't provide it, we just want to use ours.
   */
  const { link: userLink, cacheConfig, ...rest } = config ?? {}

  let link = rwLink

  if (userLink) {
    link = typeof userLink === 'function' ? userLink(rwLink) : (link = userLink)
  }

  const client = new ApolloClient({
    link,
    cache: new InMemoryCache(cacheConfig),
    /**
     * Default options for every Cell.
     *
     * @see {@link https://www.apollographql.com/docs/react/api/core/ApolloClient/#example-defaultoptions-object}
     */
    defaultOptions: {
      watchQuery: {
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
      },
    },
    ...rest,
  })

  return <ApolloProvider client={client}>{children}</ApolloProvider>
}

export const RedwoodApolloProvider: React.FunctionComponent<{
  graphQLClientConfig?: GraphQLClientConfigProp
  useAuth?: UseAuthProp
}> = ({ graphQLClientConfig, useAuth = useRWAuth, children }) => {
  return (
    <FetchConfigProvider useAuth={useAuth}>
      <ApolloProviderWithFetchConfig
        config={graphQLClientConfig}
        useAuth={useAuth}
      >
        <GraphQLHooksProvider useQuery={useQuery} useMutation={useMutation}>
          {children}
        </GraphQLHooksProvider>
      </ApolloProviderWithFetchConfig>
    </FetchConfigProvider>
  )
}
